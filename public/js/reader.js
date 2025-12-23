// public/js/reader.js - Unified reader JavaScript with ePub.js support
(function() {
  'use strict';

  // State for ePub.js reader
  let book = null;
  let rendition = null;
  let errorShown = false;
  let loadTimeoutId = null;
  let currentFontSize = 100; // percentage
  let bookKey = null; // for localStorage persistence
  let currentDirectUrl = ''; // stored for error handlers
  let currentSourceUrl = ''; // stored for source link fallback
  let bookSizeBytes = 0; // stored for timeout calculation

  // Base timeout for book loading (45 seconds minimum)
  const BASE_TIMEOUT_MS = 45000;
  // Additional timeout per MB (0.6 seconds per MB)
  const TIMEOUT_PER_MB_MS = 600;
  // Maximum timeout cap (4 minutes)
  const MAX_TIMEOUT_MS = 240000;
  // Size threshold for "very large" warning (80MB)
  const LARGE_BOOK_THRESHOLD = 80 * 1024 * 1024;
  // Display timeout for rendition.display() Promise.race (10 seconds)
  const DISPLAY_TIMEOUT_MS = 10000;
  // Content render verification timeout (8 seconds after display resolves)
  const CONTENT_VERIFY_TIMEOUT_MS = 8000;
  // PDF auto-fallback timeout (5 seconds) - switch to PDF if EPUB render fails
  const PDF_FALLBACK_TIMEOUT_MS = 5000;
  // Maximum spine item attempts before failing (increased from 5 to 10)
  const MAX_SPINE_ATTEMPTS = 10;
  // Track failed spine hrefs for logging
  const failedSpineItems = [];
  // Non-content spine items to skip (nav, toc, cover, etc)
  const NON_CONTENT_PATTERNS = [
    /nav/i, /toc/i, /table.?of.?contents/i,
    /cover/i, /title/i, /titlepage/i,
    /notice/i, /copyright/i, /colophon/i,
    /frontmatter/i, /front.?matter/i,
    /dedication/i, /epigraph/i, /preface/i,
    /acknowledgment/i, /about/i
  ];

  /**
   * Timestamped log helper for debugging EPUB loading stages
   */
  function tsLog(...args) {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[reader ${ts}]`, ...args);
  }

  /**
   * Check if a token is an Archive.org token
   * @param {Object} t - Token object with provider info
   * @returns {boolean} true if this is an Archive.org token
   */
  function isArchiveToken(t) {
    return t && t.provider === 'archive' && (t.archive_id || t.archiveId);
  }

  /**
   * Get Archive ID from token (handles both snake_case and camelCase)
   * @param {Object} t - Token object
   * @returns {string} Archive ID or empty string
   */
  function getArchiveId(t) {
    return (t && (t.archive_id || t.archiveId)) || '';
  }

  /**
   * Get the EPUB render URL for a token (uses same-origin proxy for Archive)
   * @param {Object} token - Token object with provider and URL info
   * @returns {string} URL to use for EPUB rendering
   */
  function getEpubRenderUrl(token) {
    if (isArchiveToken(token)) {
      const url = '/api/proxy/epub?archive=' + encodeURIComponent(getArchiveId(token));
      console.log('[reader] render url selected', { mode: 'epub', provider: token.provider, url: url });
      return url;
    }
    // Non-archive: use existing proxy with url param if available
    if (token && token.direct_url) {
      const url = '/api/proxy/epub?url=' + encodeURIComponent(token.direct_url);
      console.log('[reader] render url selected', { mode: 'epub', provider: token.provider || 'other', url: url });
      return url;
    }
    return '';
  }

  /**
   * Get the PDF render URL for a token (uses same-origin proxy for Archive)
   * @param {Object} token - Token object with provider and URL info
   * @param {string} [bestPdfFile] - Optional: specific PDF filename for archive items
   * @returns {string} URL to use for PDF rendering
   */
  function getPdfRenderUrl(token, bestPdfFile) {
    if (isArchiveToken(token)) {
      let url = '/api/proxy/pdf?archive=' + encodeURIComponent(getArchiveId(token));
      // If a specific PDF file is provided, use it for deterministic selection
      if (bestPdfFile) {
        url += '&file=' + encodeURIComponent(bestPdfFile);
      }
      console.log('[reader] render url selected', { mode: 'pdf', provider: token.provider, url: url, bestPdf: bestPdfFile || '(auto)' });
      return url;
    }
    // Non-archive: return direct_url if it's a PDF, otherwise proxy it
    if (token && token.direct_url) {
      if (token.direct_url.toLowerCase().endsWith('.pdf')) {
        console.log('[reader] render url selected', { mode: 'pdf', provider: token.provider || 'other', url: token.direct_url });
        return token.direct_url;
      }
      const url = '/api/proxy/pdf?url=' + encodeURIComponent(token.direct_url);
      console.log('[reader] render url selected', { mode: 'pdf', provider: token.provider || 'other', url: url });
      return url;
    }
    return '';
  }

  /**
   * Check if a spine item href is likely actual content (not nav/toc/cover)
   * @param {string} href - The spine item href
   * @returns {boolean} true if likely content
   */
  function isLikelyContent(href) {
    if (!href) return false;
    const hrefLower = href.toLowerCase();
    return !NON_CONTENT_PATTERNS.some(pattern => pattern.test(hrefLower));
  }

  /**
   * Get prioritized list of spine items to try
   * Filters out non-content items and prioritizes linear="yes" items
   * @param {Object} spine - epub.js spine object
   * @returns {Array} Ordered list of spine items to try
   */
  function getPrioritizedSpineItems(spine) {
    if (!spine || !spine.length) return [];
    
    const candidates = [];
    const nonContentItems = [];
    
    for (let i = 0; i < spine.length; i++) {
      const item = spine.get(i);
      if (!item || !item.href) continue;
      
      const isContent = isLikelyContent(item.href);
      const isLinear = item.linear !== 'no';
      
      if (isContent && isLinear) {
        candidates.push({ item, index: i, priority: 0 });
      } else if (isContent) {
        candidates.push({ item, index: i, priority: 1 });
      } else {
        nonContentItems.push({ item, index: i, priority: 2 });
      }
    }
    
    // Sort by priority, then by index
    candidates.sort((a, b) => a.priority - b.priority || a.index - b.index);
    
    // Add non-content items at the end as fallback
    return [...candidates, ...nonContentItems].slice(0, MAX_SPINE_ATTEMPTS);
  }

  /**
   * Calculate dynamic timeout based on book size
   * @param {number} sizeBytes - Book size in bytes
   * @returns {number} Timeout in milliseconds
   */
  function calculateTimeout(sizeBytes) {
    if (!sizeBytes || sizeBytes < 1) return BASE_TIMEOUT_MS;
    const sizeMB = sizeBytes / 1e6;
    const dynamicTimeout = BASE_TIMEOUT_MS + (sizeMB * TIMEOUT_PER_MB_MS);
    return Math.min(dynamicTimeout, MAX_TIMEOUT_MS);
  }

  /**
   * Clear the load timeout watchdog safely
   */
  function clearLoadTimeout() {
    if (loadTimeoutId) {
      clearTimeout(loadTimeoutId);
      loadTimeoutId = null;
    }
  }

  // Default theme CSS to inject into EPUB for proper rendering
  const DEFAULT_READER_THEME = {
    'body': {
      'max-width': '720px !important',
      'margin': '0 auto !important',
      'padding': '24px 20px !important',
      'line-height': '1.7 !important',
      'font-family': 'Georgia, "Times New Roman", serif !important',
      'font-size': '18px !important',
      'color': '#1a1a1a !important',
      'background': '#ffffff !important',
      'overflow-x': 'hidden !important',
      'word-wrap': 'break-word !important',
      'overflow-wrap': 'anywhere !important'
    },
    'p': {
      'margin': '0 0 1em 0 !important',
      'line-height': '1.7 !important',
      'text-align': 'justify !important',
      'hyphens': 'auto !important'
    },
    'pre': {
      'white-space': 'pre-wrap !important',
      'overflow-wrap': 'anywhere !important',
      'word-break': 'break-word !important',
      'max-width': '100% !important',
      'overflow-x': 'auto !important',
      'background': '#f5f5f5 !important',
      'padding': '1em !important',
      'border-radius': '4px !important',
      'font-size': '0.9em !important',
      'line-height': '1.5 !important'
    },
    'code': {
      'white-space': 'pre-wrap !important',
      'word-break': 'break-word !important',
      'font-size': '0.9em !important'
    },
    'img': {
      'max-width': '100% !important',
      'height': 'auto !important',
      'display': 'block !important',
      'margin': '1em auto !important'
    },
    'svg': {
      'max-width': '100% !important',
      'height': 'auto !important'
    },
    'table': {
      'max-width': '100% !important',
      'overflow-x': 'auto !important',
      'display': 'block !important'
    },
    'h1, h2, h3, h4, h5, h6': {
      'line-height': '1.3 !important',
      'margin-top': '1.5em !important',
      'margin-bottom': '0.5em !important'
    },
    'a': {
      'color': '#4f46e5 !important',
      'text-decoration': 'underline !important'
    },
    '*': {
      'max-width': '100% !important',
      'box-sizing': 'border-box !important'
    }
  };

  // Global error handlers - use direct assignment to ensure we catch ALL errors
  // This prevents "timeout after crash" by catching epub.js errors immediately
  window.onerror = function(message, source, lineno, colno, error) {
    if (!errorShown) {
      const msg = String(message || '');
      // Log full error details including stack trace for debugging (Problem C improvement)
      console.error('[reader] window.onerror:', msg);
      console.error('[reader] window.onerror stack:', error?.stack || '(no stack)');
      console.error('[reader] window.onerror source:', source, 'line:', lineno, 'col:', colno);
      // Catch any error during EPUB loading
      if (msg.includes('indexOf') || msg.includes('undefined') || msg.includes('null') || 
          msg.includes('Cannot read') || msg.includes('epub') || (source && source.includes('epub'))) {
        clearLoadTimeout();
        showEpubError("This book can't be opened in the reader. Try another edition.", currentSourceUrl);
      }
    }
    return true; // Prevent duplicate console spam
  };

  window.onunhandledrejection = function(event) {
    if (!errorShown) {
      const reason = event.reason?.message || String(event.reason || '');
      // Log full rejection details including stack trace for debugging (Problem C improvement)
      console.error('[reader] unhandledrejection:', reason);
      console.error('[reader] unhandledrejection stack:', event.reason?.stack || '(no stack)');
      clearLoadTimeout();
      if (reason.includes('indexOf') || reason.includes('undefined') || reason.includes('null') || reason.includes('Cannot read')) {
        showEpubError("This book can't be opened in the reader. Try another edition.", currentSourceUrl);
      } else {
        showEpubError('Failed to process book file. Please try a different edition.', currentSourceUrl);
      }
    }
  };

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Setup back button enhancement
    setupBackButton();
    
    // Check if this is an EPUB reader page
    const isEpubPage = document.body.getAttribute('data-epub') === 'true';
    const isPdfPage = document.body.getAttribute('data-pdf') === 'true';
    
    // Check for Archive/OpenLibrary items with best_pdf - start directly in PDF mode
    // This avoids unnecessary EPUB proxy prefetch when we know PDF is preferred
    const archiveId = document.body.getAttribute('data-archive-id');
    const bestPdf = document.body.getAttribute('data-best-pdf');
    const dataFormat = (document.body.getAttribute('data-format') || '').toLowerCase();
    
    // Check URL params for explicit mode request
    const urlParams = new URLSearchParams(window.location.search);
    const explicitEpub = urlParams.get('mode') === 'epub';
    
    // If this is an Archive item with best_pdf, prefer PDF mode by default
    // Unless user explicitly requested EPUB mode via ?mode=epub
    const shouldUsePdfDirectly = archiveId && bestPdf && isEpubPage && !isPdfPage && !explicitEpub;
    
    if (shouldUsePdfDirectly) {
      tsLog('Archive item with best_pdf detected, starting directly in PDF mode');
      tsLog('Archive ID:', archiveId, 'Best PDF:', bestPdf, 'Format:', dataFormat || '(default)');
      
      // Show calm loading message
      updateLoadingMessage('Preparing book...');
      
      // Start PDF viewer directly with "Try EPUB" option
      startPdfViewerDirectly(archiveId, bestPdf, true);
      return;
    }
    
    if (isPdfPage) {
      // Setup PDF viewer handling
      initPdfViewer();
    } else if (isEpubPage) {
      // Check if this is a "too large" book that should show edition picker
      const isTooLarge = document.body.getAttribute('data-too-large') === 'true';
      const availableFiles = document.body.getAttribute('data-available-files');
      
      if (isTooLarge && availableFiles && availableFiles !== 'null') {
        // Show edition picker instead of auto-loading
        showEditionPicker(JSON.parse(availableFiles));
      } else {
        // Setup toolbar controls
        setupToolbarControls();
        
        // Initialize ePub.js renderer with global error wrapper
        try {
          initEpubReader().catch(err => {
            console.error('[reader] Init failed:', err);
            if (!errorShown) {
              showReaderError('Failed to initialize reader. Please try again.');
            }
          });
        } catch (err) {
          console.error('[reader] Init error:', err);
          showReaderError('Failed to initialize reader. Please try again.');
        }
      }
    } else {
      // Setup keyboard shortcuts for iframe
      setupKeyboardShortcuts();
    }
  }
  
  /**
   * Start PDF viewer directly for Archive items with known best_pdf
   * This bypasses EPUB loading entirely when we know PDF is the best option
   * @param {string} archiveId - Archive.org identifier
   * @param {string} bestPdfFile - The best PDF filename for this archive
   * @param {boolean} [showEpubOption=false] - Whether to show "Try EPUB instead" option
   * @param {string} [bannerMessage=''] - Optional custom banner message
   */
  function startPdfViewerDirectly(archiveId, bestPdfFile, showEpubOption, bannerMessage) {
    const viewer = document.getElementById('epub-viewer');
    const loading = document.getElementById('epub-loading');
    
    if (!viewer) {
      console.error('[reader] epub-viewer element not found for PDF direct start');
      return;
    }
    
    // Build the PDF proxy URL with deterministic file selection
    const pdfProxyUrl = '/api/proxy/pdf?archive=' + encodeURIComponent(archiveId) + 
                        '&file=' + encodeURIComponent(bestPdfFile);
    
    tsLog('Starting PDF viewer directly with URL:', pdfProxyUrl);
    
    // Hide loading indicator
    if (loading) {
      loading.style.display = 'none';
    }
    
    // Build "Try EPUB instead" button if requested
    const epubButton = showEpubOption 
      ? `<button id="try-epub-btn" style="margin-left: 12px; padding: 4px 10px; font-size: 12px; background: transparent; border: 1px solid #0369a1; color: #0369a1; border-radius: 4px; cursor: pointer;">Try EPUB instead</button>`
      : '';
    
    // Use custom banner message or default
    const noticeText = bannerMessage || 'Preparing book…';
    
    // Inject PDF viewer into the epub-viewer container
    viewer.innerHTML = `
      <div class="pdf-fallback-container" style="height: 100%; display: flex; flex-direction: column;">
        <div class="pdf-fallback-notice" style="background: #e0f2fe; color: #0369a1; padding: 8px 16px; font-size: 13px; text-align: center; flex-shrink: 0;">
          <span>📄 ${noticeText}</span>${epubButton}
        </div>
        <iframe 
          id="direct-pdf-frame"
          class="pdf-fallback-frame" 
          src="${pdfProxyUrl}" 
          title="PDF Viewer"
          loading="eager"
          style="flex: 1; width: 100%; border: none; background: #f5f5f5;"
          allow="fullscreen"
        ></iframe>
      </div>
    `;
    
    // Setup "Try EPUB instead" click handler if present
    const tryEpubBtn = document.getElementById('try-epub-btn');
    if (tryEpubBtn) {
      tryEpubBtn.addEventListener('click', function() {
        // Reload page with mode=epub to force EPUB view
        const url = new URL(window.location.href);
        url.searchParams.set('mode', 'epub');
        window.location.href = url.toString();
      });
    }
    
    // Setup load/error handlers for the PDF iframe
    const pdfFrame = document.getElementById('direct-pdf-frame');
    if (pdfFrame) {
      let loaded = false;
      const loadTimeout = setTimeout(function() {
        if (!loaded && !errorShown) {
          tsLog('Direct PDF load timeout');
          showPdfProxyError();
        }
      }, 20000); // 20 second timeout
      
      pdfFrame.addEventListener('load', function() {
        loaded = true;
        clearTimeout(loadTimeout);
        tsLog('Direct PDF loaded successfully');
      });
      
      pdfFrame.addEventListener('error', function() {
        loaded = true;
        clearTimeout(loadTimeout);
        tsLog('Direct PDF iframe error');
        showPdfProxyError();
      });
    }
    
    // Mark as handled to prevent other error handlers
    errorShown = true;
  }

  /**
   * Initialize PDF viewer with timeout fallback
   */
  function initPdfViewer() {
    const pdfFrame = document.getElementById('pdf-frame');
    const pdfLoading = document.getElementById('pdf-loading');
    const pdfFallback = document.getElementById('pdf-fallback');
    
    if (!pdfFrame) return;
    
    let loadTimeout = null;
    let loaded = false;
    
    // Set a timeout for PDF loading (15 seconds)
    loadTimeout = setTimeout(function() {
      if (!loaded) {
        tsLog('PDF load timeout - showing fallback');
        if (pdfLoading) pdfLoading.style.display = 'none';
        if (pdfFallback) pdfFallback.style.display = 'flex';
      }
    }, 15000);
    
    // Hide loading when iframe loads
    pdfFrame.addEventListener('load', function() {
      loaded = true;
      if (loadTimeout) clearTimeout(loadTimeout);
      
      // Give a short delay to check if content actually rendered
      setTimeout(function() {
        if (pdfLoading) {
          pdfLoading.style.display = 'none';
        }
        tsLog('PDF loaded in iframe');
      }, 500);
    });
    
    // Handle errors
    pdfFrame.addEventListener('error', function() {
      loaded = true;
      if (loadTimeout) clearTimeout(loadTimeout);
      tsLog('PDF iframe error');
      if (pdfLoading) pdfLoading.style.display = 'none';
      if (pdfFallback) pdfFallback.style.display = 'flex';
    });
  }

  /**
   * Show edition picker for large books
   */
  function showEditionPicker(availableFiles) {
    const loading = document.getElementById('epub-loading');
    const picker = document.getElementById('edition-picker');
    const optionsContainer = document.getElementById('edition-picker-options');
    
    if (loading) loading.style.display = 'none';
    if (!picker || !optionsContainer) {
      // No edition picker in DOM, try loading anyway
      setupToolbarControls();
      initEpubReader();
      return;
    }
    
    const archiveId = document.body.getAttribute('data-archive-id');
    
    // Build options from available files
    let optionsHtml = '';
    
    // Check for PDFs first (preferred for large books)
    if (availableFiles.pdfs && availableFiles.pdfs.length > 0) {
      const pdf = availableFiles.pdfs[0];
      const sizeMB = Math.round(pdf.size / 1e6);
      // Use data attribute instead of inline onclick (CSP-safe)
      optionsHtml += `
        <button class="edition-picker-btn primary" data-pdf-archive="${archiveId}">
          Open as PDF (${sizeMB} MB) - Recommended
        </button>
      `;
    }
    
    // Show EPUB options
    if (availableFiles.epubs && availableFiles.epubs.length > 0) {
      availableFiles.epubs.slice(0, 3).forEach((epub, i) => {
        const sizeMB = Math.round(epub.size / 1e6);
        optionsHtml += `
          <div class="edition-option">
            <span>${epub.name} (${sizeMB} MB)</span>
          </div>
        `;
      });
    }
    
    optionsContainer.innerHTML = optionsHtml;
    picker.style.display = 'flex';
    
    // Setup PDF button click handler (CSP-safe, no inline onclick)
    optionsContainer.querySelectorAll('[data-pdf-archive]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var archive = this.getAttribute('data-pdf-archive');
        if (archive) {
          window.location.href = '/api/proxy/pdf?archive=' + encodeURIComponent(archive);
        }
      });
    });
    
    // Setup "Try Anyway" button
    const tryAnywayBtn = document.getElementById('try-anyway-btn');
    if (tryAnywayBtn) {
      tryAnywayBtn.addEventListener('click', function() {
        picker.style.display = 'none';
        if (loading) loading.style.display = 'flex';
        setupToolbarControls();
        initEpubReader();
      });
    }
  }

  /**
   * Setup toolbar controls (font size, TOC)
   */
  function setupToolbarControls() {
    // Font size controls
    const fontDecBtn = document.getElementById('font-decrease');
    const fontIncBtn = document.getElementById('font-increase');
    const tocToggle = document.getElementById('toc-toggle');
    const tocPanel = document.getElementById('toc-panel');
    const tocClose = document.getElementById('toc-close');
    const tocOverlay = document.getElementById('toc-overlay');
    
    if (fontDecBtn) {
      fontDecBtn.addEventListener('click', function() {
        changeFontSize(-10);
      });
    }
    
    if (fontIncBtn) {
      fontIncBtn.addEventListener('click', function() {
        changeFontSize(10);
      });
    }
    
    // TOC toggle handler
    function toggleTOC(open) {
      if (!tocPanel) return;
      if (typeof open === 'boolean') {
        tocPanel.classList.toggle('open', open);
      } else {
        tocPanel.classList.toggle('open');
      }
      // Update overlay visibility
      if (tocOverlay) {
        tocOverlay.classList.toggle('visible', tocPanel.classList.contains('open'));
      }
    }
    
    if (tocToggle) {
      tocToggle.addEventListener('click', function() {
        toggleTOC();
      });
    }
    
    if (tocClose) {
      tocClose.addEventListener('click', function() {
        toggleTOC(false);
      });
    }
    
    // Close TOC when clicking overlay
    if (tocOverlay) {
      tocOverlay.addEventListener('click', function() {
        toggleTOC(false);
      });
    }
    
    // Close TOC panel when clicking outside (desktop)
    document.addEventListener('click', function(e) {
      if (tocPanel && tocPanel.classList.contains('open')) {
        if (!tocPanel.contains(e.target) && e.target !== tocToggle && !tocToggle.contains(e.target)) {
          toggleTOC(false);
        }
      }
    });
  }

  /**
   * Apply current font size to rendition using inline styles
   * (Avoids epub.js themes which use blob: stylesheets blocked by CSP)
   */
  function applyFontSize() {
    if (!rendition) return;
    try {
      var contents = rendition.getContents();
      contents.forEach(function(c) {
        if (c && c.document) {
          c.document.documentElement.style.fontSize = currentFontSize + '%';
          if (c.document.body) {
            c.document.body.style.fontSize = currentFontSize + '%';
          }
        }
      });
      tsLog('font size ->', currentFontSize + '%');
    } catch (err) {
      console.warn('[reader] Failed to apply font size:', err);
    }
  }

  /**
   * Change font size
   */
  function changeFontSize(delta) {
    currentFontSize = Math.max(70, Math.min(150, currentFontSize + delta));
    
    // Apply to rendition
    applyFontSize();
    
    // Update display if element exists
    const fontDisplay = document.getElementById('font-size-display');
    if (fontDisplay) {
      fontDisplay.textContent = currentFontSize + '%';
    }
    
    // Save preference to localStorage
    try {
      localStorage.setItem('bl-reader-fontsize', currentFontSize);
    } catch (e) {
      console.warn('[reader] Could not save font size:', e);
    }
  }

  /**
   * Generate stable book key for localStorage
   */
  function generateBookKey(epubUrl, archiveId) {
    if (archiveId) {
      return 'bl-book-' + archiveId;
    }
    // Use URL hash as fallback
    let hash = 0;
    for (let i = 0; i < epubUrl.length; i++) {
      hash = ((hash << 5) - hash) + epubUrl.charCodeAt(i);
      hash |= 0;
    }
    return 'bl-book-' + Math.abs(hash);
  }

  /**
   * Save reading location
   */
  function saveLocation(cfi) {
    if (!bookKey || !cfi) return;
    try {
      localStorage.setItem(bookKey + '-loc', cfi);
    } catch (e) {
      console.warn('[reader] Could not save location:', e);
    }
  }

  /**
   * Get saved reading location
   */
  function getSavedLocation() {
    if (!bookKey) return null;
    try {
      return localStorage.getItem(bookKey + '-loc');
    } catch (e) {
      return null;
    }
  }

  /**
   * Initialize ePub.js reader
   */
  async function initEpubReader() {
    const viewer = document.getElementById('epub-viewer');
    const loading = document.getElementById('epub-loading');

    // Log JSZip availability to verify epub.js dependency is present
    tsLog('JSZip available:', typeof JSZip !== 'undefined');
    
    if (!viewer) {
      console.error('[reader] epub-viewer element not found');
      return;
    }
    
    const epubUrl = viewer.getAttribute('data-epub-url');
    const archiveId = viewer.getAttribute('data-archive-id');
    const directUrl = viewer.getAttribute('data-direct-url') || '';
    const sourceUrl = viewer.getAttribute('data-source-url') || directUrl;
    const bestPdf = viewer.getAttribute('data-best-pdf') || '';
    
    // Store URLs globally for error handlers
    currentDirectUrl = directUrl;
    currentSourceUrl = sourceUrl;
    
    // Store bestPdf globally for fallback
    var currentBestPdf = bestPdf;
    
    if (!epubUrl) {
      console.error('[reader] No EPUB URL provided');
      showEpubError('No book URL provided', sourceUrl);
      return;
    }
    
    // Generate stable book key for persistence
    bookKey = generateBookKey(epubUrl, archiveId);
    tsLog('Book key:', bookKey);
    tsLog('Best PDF:', bestPdf || '(none)');
    
    // Restore saved font size
    try {
      const savedFontSize = localStorage.getItem('bl-reader-fontsize');
      if (savedFontSize) {
        currentFontSize = parseInt(savedFontSize, 10) || 100;
        const fontDisplay = document.getElementById('font-size-display');
        if (fontDisplay) {
          fontDisplay.textContent = currentFontSize + '%';
        }
      }
    } catch (e) {}
    
    tsLog('Loading EPUB from:', epubUrl);
    tsLog('Archive ID:', archiveId || '(none)');
    tsLog('Source URL:', sourceUrl);
    
    // Check if ePub.js is loaded
    if (typeof ePub === 'undefined') {
      console.error('[reader] ePub.js library not loaded');
      showEpubError('Reader library failed to load. Please refresh the page.', sourceUrl);
      return;
    }
    
    // Initial timeout (will be updated after we get Content-Length)
    let currentTimeout = BASE_TIMEOUT_MS;
    loadTimeoutId = setTimeout(function() {
      if (!errorShown) {
        console.error('[reader] Load timeout exceeded after', currentTimeout, 'ms');
        clearLoadTimeout();
        // Try PDF fallback for Archive items before showing error
        if (archiveId) {
          tryPdfFallbackWithMessage(archiveId, sourceUrl, currentBestPdf);
        } else {
          showEpubError("This edition couldn't be rendered. Please try another edition.", sourceUrl);
        }
      }
    }, currentTimeout);
    
    try {
      // Build token-like object from data attributes for helper functions
      const token = {
        provider: archiveId ? 'archive' : 'other',
        archive_id: archiveId,
        direct_url: epubUrl
      };
      
      // Use helper function to get proxied URL (never embeds archive.org directly)
      let proxiedUrl = getEpubRenderUrl(token);
      
      // Fallback: detect archive URLs from epubUrl if no archiveId
      if (!proxiedUrl && !archiveId) {
        const archiveMatch = epubUrl.match(/archive\.org\/download\/([^\/]+)/);
        if (archiveMatch) {
          token.provider = 'archive';
          token.archive_id = archiveMatch[1];
          proxiedUrl = getEpubRenderUrl(token);
          tsLog('Detected archive from URL, using:', proxiedUrl);
        }
      }
      
      if (!proxiedUrl) {
        proxiedUrl = '/api/proxy/epub?url=' + encodeURIComponent(epubUrl);
        console.log('[reader] render url selected', { mode: 'epub', provider: 'fallback', url: proxiedUrl });
      }
      
      tsLog('EPUB proxy URL:', proxiedUrl);
      
      // Update loading message
      tsLog('Download started');
      updateLoadingMessage('Downloading book...');
      
      // Fetch the EPUB as an ArrayBuffer
      // Include credentials to maintain session for gating
      const response = await fetch(proxiedUrl, {
        credentials: 'include'
      });
      
      // Read Content-Length to adjust timeout and detect large books
      const contentLength = response.headers.get('content-length') || response.headers.get('x-book-bytes');
      bookSizeBytes = contentLength ? parseInt(contentLength, 10) : 0;
      
      // Log response details for debugging
      tsLog('Proxy response:', response.status, 'Content-Type:', response.headers.get('content-type'), 'Size:', bookSizeBytes, 'bytes');
      tsLog('Download finished');
      
      // Adjust timeout based on book size
      if (bookSizeBytes > 0) {
        clearLoadTimeout();
        currentTimeout = calculateTimeout(bookSizeBytes);
        tsLog('Adjusted timeout:', Math.round(currentTimeout/1000), 'seconds for', Math.round(bookSizeBytes/1e6), 'MB');
        loadTimeoutId = setTimeout(function() {
          if (!errorShown) {
            tsLog('ERROR: Load timeout exceeded after', currentTimeout, 'ms');
            clearLoadTimeout();
            // Try PDF fallback for Archive items before showing error
            if (archiveId) {
              tryPdfFallbackWithMessage(archiveId, sourceUrl, currentBestPdf);
            } else {
              showEpubError("This edition couldn't be rendered. Please try another edition.", sourceUrl);
            }
          }
        }, currentTimeout);
        
        // Show calmer message for very large books (no scary warning)
        if (bookSizeBytes > LARGE_BOOK_THRESHOLD) {
          const sizeMB = Math.round(bookSizeBytes / 1e6);
          tsLog('Large book detected:', sizeMB, 'MB');
          updateLoadingMessage('Preparing book...');
        }
      }
      
      if (!response.ok) {
        let errorDetail = '';
        let errorJson = null;
        try {
          errorJson = await response.json();
          errorDetail = errorJson.error || '';
        } catch {
          errorDetail = await response.text().catch(() => '');
        }
        console.error('[reader] Proxy fetch failed:', response.status, errorDetail);
        
        // Use source_url from error response if available
        const errorSourceUrl = errorJson?.source_url || sourceUrl;
        
        if (response.status === 403) {
          showEpubError('This book source is not supported. Please try a different edition.', errorSourceUrl);
        } else if (response.status === 404) {
          showEpubError('Book file not found. The source may have moved or been removed.', errorSourceUrl);
        } else if (response.status === 504) {
          showEpubError('Download timed out. Please try again later.', errorSourceUrl);
        } else if (response.status === 502) {
          showEpubError('Could not fetch book from source. ' + (errorDetail || 'Please try again later.'), errorSourceUrl);
        } else if (response.status === 422 || response.status === 409) {
          // Handle no_epub_available: try PDF fallback if available
          clearLoadTimeout();
          
          if (errorJson && (errorJson.error === 'no_epub_available' || errorJson.error === 'Invalid EPUB (not a ZIP archive)')) {
            // Server says no valid EPUB - try PDF fallback
            const fallbackPdf = errorJson.best_pdf || currentBestPdf;
            if (archiveId && (fallbackPdf || errorJson.has_pdf_fallback)) {
              tsLog('No valid EPUB, trying PDF fallback');
              tryPdfFallbackWithMessage(archiveId, errorSourceUrl, fallbackPdf);
              return;
            }
          }
          
          // No fallback available - show clean error
          const isAdmin = document.body.getAttribute('data-is-admin') === 'true';
          const showDiagnostics = document.body.getAttribute('data-show-source-links') === 'true';
          if (isAdmin || showDiagnostics) {
            showEpubError("This title can't be opened on BookLantern right now. (Diagnostic: " + errorDetail + ")", errorSourceUrl);
          } else {
            showEpubError("This title can't be opened on BookLantern right now.", errorSourceUrl);
          }
          return;
        } else if (response.status === 401) {
          showEpubError('Please log in to read books.', errorSourceUrl);
        } else {
          showEpubError('Failed to download book. Please try again later.', errorSourceUrl);
        }
        return;
      }
      
      // Get the ArrayBuffer
      tsLog('Processing ArrayBuffer...');
      updateLoadingMessage('Processing book...');
      const arrayBuffer = await response.arrayBuffer();
      
      if (!arrayBuffer || arrayBuffer.byteLength < 100) {
        tsLog('ERROR: EPUB file too small or empty:', arrayBuffer?.byteLength);
        showEpubError('The book file appears to be empty or corrupted.', sourceUrl);
        return;
      }
      
      tsLog('Downloaded EPUB, size:', arrayBuffer.byteLength, 'bytes');
      
      // Validate ZIP signature (EPUB must be a ZIP file starting with 'PK')
      const header = new Uint8Array(arrayBuffer.slice(0, 4));
      const isZip = header[0] === 0x50 && header[1] === 0x4B; // 'PK'
      if (!isZip) {
        tsLog('ERROR: File is not a valid ZIP/EPUB (header:', header, ')');
        clearLoadTimeout();
        showEpubError('This file is not a valid EPUB. It may be an HTML page or different format.', sourceUrl);
        return;
      }
      tsLog('ZIP signature validated');
      
      // Validate EPUB structure: must contain META-INF/container.xml and valid OPF
      tsLog('Unzip started');
      updateLoadingMessage('Validating EPUB structure...');
      try {
        var zip = await JSZip.loadAsync(arrayBuffer);
        
        // Find META-INF/container.xml case-insensitively
        var containerXmlFile = null;
        var containerXmlKey = null;
        for (var key in zip.files) {
          if (key.toLowerCase() === 'meta-inf/container.xml') {
            containerXmlFile = zip.file(key);
            containerXmlKey = key;
            break;
          }
        }
        
        if (!containerXmlFile) {
          tsLog('ERROR: Missing META-INF/container.xml - not a valid EPUB');
          clearLoadTimeout();
          showEpubError('This file is not a valid EPUB (missing container.xml). Try another edition.', sourceUrl);
          return;
        }
        tsLog('container.xml found at:', containerXmlKey);
        
        // Parse container.xml to find the rootfile path
        var containerContent = await containerXmlFile.async('string');
        var opfPath = null;
        try {
          var containerParser = new DOMParser();
          var containerDoc = containerParser.parseFromString(containerContent, 'application/xml');
          var rootfile = containerDoc.querySelector('rootfile');
          if (rootfile && rootfile.getAttribute('full-path')) {
            opfPath = rootfile.getAttribute('full-path');
          }
        } catch (parseErr) {
          tsLog('WARN: Could not parse container.xml:', parseErr);
        }
        
        if (!opfPath) {
          tsLog('ERROR: Could not extract rootfile path from container.xml');
          clearLoadTimeout();
          showEpubError('Invalid EPUB structure (no rootfile in container.xml). Try another edition.', sourceUrl);
          return;
        }
        tsLog('OPF path from container.xml:', opfPath);
        
        // Verify the OPF file exists in the zip (case-insensitive)
        var opfExists = false;
        for (var key in zip.files) {
          if (key.toLowerCase() === opfPath.toLowerCase()) {
            opfExists = true;
            tsLog('OPF file found at:', key);
            break;
          }
        }
        
        if (!opfExists) {
          tsLog('ERROR: OPF file not found in ZIP:', opfPath);
          clearLoadTimeout();
          showEpubError('Invalid EPUB structure (OPF file not found). Try another edition.', sourceUrl);
          return;
        }
        
        tsLog('EPUB structure validated successfully');
      } catch (zipErr) {
        tsLog('ERROR: JSZip validation failed:', zipErr);
        clearLoadTimeout();
        showEpubError('Failed to validate EPUB structure. The file may be corrupted.', sourceUrl);
        return;
      }
      
      // Open EPUB via ArrayBuffer
      tsLog('book load started');
      updateLoadingMessage('Opening book...');
      
      try {
        // Open epub.js with ArrayBuffer directly
        book = ePub(arrayBuffer);
        tsLog('ePub() constructor succeeded');
      } catch (err) {
        clearLoadTimeout();
        tsLog('ERROR: ePub() constructor failed:', err);
        showEpubError('Invalid EPUB format. This file cannot be opened in the reader.', sourceUrl);
        return;
      }
      
      // Wait for book.ready to get spine info before display
      tsLog('Waiting for book.ready...');
      try {
        await book.ready;
        tsLog('book.ready resolved');
        
        // Log spine info for debugging
        if (book.spine && book.spine.length) {
          tsLog('Spine length:', book.spine.length);
          const spinePreview = [];
          for (let i = 0; i < Math.min(3, book.spine.length); i++) {
            const item = book.spine.get(i);
            if (item) spinePreview.push(item.href || '(no href)');
          }
          tsLog('First 3 spine hrefs:', spinePreview.join(', '));
        } else {
          tsLog('WARNING: No spine items found');
        }
      } catch (readyErr) {
        tsLog('WARNING: book.ready failed (continuing):', readyErr.message);
      }
      
      // Render the book into the viewer
      // Use scrolled-doc flow for better mobile experience
      tsLog('rendition creation started');
      try {
        rendition = book.renderTo('epub-viewer', {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'scrolled-doc',
          allowScriptedContent: false
        });
        tsLog('rendition created successfully');
      } catch (err) {
        clearLoadTimeout();
        tsLog('ERROR: renderTo() failed:', err);
        showEpubError('Failed to render book. It may be corrupted or in an unsupported format.', sourceUrl);
        return;
      }
      
      // Use content hooks to inject styles inline (avoids CSP blob: stylesheet issues)
      // Track when first content actually renders (not just display() resolves)
      let firstContentRendered = false;
      let relocatedFired = false;
      let currentSpineHref = null; // Track which spine item we're attempting
      
      rendition.hooks.content.register(function(contents) {
        try {
          tsLog('content hook fired');
          
          // Add error handlers inside the EPUB iframe
          contents.window.addEventListener('error', function(e) {
            tsLog('iframe error:', e.message);
            tsLog('iframe error stack:', e.error?.stack || '(no stack)');
            if (!firstContentRendered) {
              clearLoadTimeout();
              showEpubError("This book can't be opened in the reader. Try another edition.", currentSourceUrl);
            }
          });
          contents.window.addEventListener('unhandledrejection', function(e) {
            tsLog('iframe rejection:', e.reason);
            tsLog('iframe rejection stack:', e.reason?.stack || '(no stack)');
            if (!firstContentRendered) {
              clearLoadTimeout();
              showEpubError("This book can't be opened in the reader. Try another edition.", currentSourceUrl);
            }
          });
          
          // Inject default theme styles inline
          contents.addStylesheetRules(DEFAULT_READER_THEME);
          
          // Apply font size inline
          contents.document.documentElement.style.fontSize = currentFontSize + '%';
          if (contents.document.body) {
            contents.document.body.style.fontSize = currentFontSize + '%';
          }
          tsLog('Content hook: styles applied, font size:', currentFontSize + '%');
          
          // Clear timeout when content actually renders successfully
          if (!firstContentRendered) {
            firstContentRendered = true;
            clearLoadTimeout();
            tsLog('First spine content rendered successfully - timeout cleared');
            hideLoading();
          }
        } catch (err) {
          tsLog('WARN: Content hook error:', err);
        }
      });
      
      // Setup navigation buttons early (before display completes)
      setupEpubNavigation();
      
      // Setup keyboard navigation
      setupEpubKeyboard();
      
      // Track location changes for persistence and re-apply font size
      rendition.on('relocated', function(location) {
        relocatedFired = true;
        tsLog('relocated event fired');
        if (location && location.start && location.start.cfi) {
          saveLocation(location.start.cfi);
        }
        // Re-apply font size on navigation
        applyFontSize();
      });
      
      // Re-apply font size when new content is rendered
      rendition.on('rendered', function() {
        tsLog('rendered event fired');
        applyFontSize();
      });
      
      // Display the book - try to restore saved location
      // Use Promise.race with timeout for robust display handling
      tsLog('rendition.display() starting');
      try {
        const savedLocation = getSavedLocation();
        
        // Helper: display with Promise.race timeout
        async function displayWithTimeout(location, timeoutMs) {
          currentSpineHref = location || '(start)';
          tsLog('rendition.display() attempt at:', currentSpineHref);
          
          const displayPromise = location ? rendition.display(location) : rendition.display();
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('DISPLAY_TIMEOUT')), timeoutMs);
          });
          
          return Promise.race([displayPromise, timeoutPromise]);
        }
        
        // Helper: try display with fallbacks - improved with better spine selection
        let displayError = null;
        let displayAttempts = 0;
        const maxAttempts = MAX_SPINE_ATTEMPTS;
        
        async function tryDisplay(location) {
          displayAttempts++;
          try {
            await displayWithTimeout(location, DISPLAY_TIMEOUT_MS);
            tsLog('rendition.display() SUCCEEDED for:', location || '(start)');
            // Log which items failed before success
            if (failedSpineItems.length > 0) {
              tsLog('Previously failed spine items:', failedSpineItems.join(', '));
            }
            return true;
          } catch (err) {
            const isTimeout = err.message === 'DISPLAY_TIMEOUT';
            const failedHref = location || 'spine_start';
            failedSpineItems.push(failedHref);
            tsLog(`Display attempt ${displayAttempts} ${isTimeout ? 'TIMEOUT' : 'FAILED'} at "${failedHref}":`, err.message);
            displayError = err;
            return false;
          }
        }
        
        // Try saved location first
        if (savedLocation) {
          const success = await tryDisplay(savedLocation);
          if (!success) {
            tsLog('Saved location failed, trying prioritized spine items');
          }
        }
        
        // If no saved location or it failed, try prioritized spine items
        if (!savedLocation || displayError) {
          displayError = null;
          
          // Try start first
          let success = await tryDisplay(null);
          
          if (!success && book.spine && book.spine.length > 1) {
            // Get prioritized spine items (filters out nav/toc/cover)
            const prioritizedItems = getPrioritizedSpineItems(book.spine);
            tsLog('Prioritized spine candidates:', prioritizedItems.map(p => p.item.href).join(', '));
            
            // Try each prioritized spine item
            for (const candidate of prioritizedItems) {
              if (displayAttempts >= maxAttempts) break;
              
              tsLog('Trying prioritized spine item:', candidate.item.href, '(index:', candidate.index, ')');
              displayError = null;
              success = await tryDisplay(candidate.item.href);
              if (success) break;
            }
          }
        }
        
        // If all EPUB attempts failed, try PDF fallback for Archive items
        if (displayError && archiveId) {
          tsLog('All EPUB attempts failed, checking for PDF fallback');
          updateLoadingMessage('Switching to PDF version...');
          const pdfFallbackSuccess = await tryPdfFallback(archiveId, sourceUrl);
          if (pdfFallbackSuccess) {
            return; // PDF fallback succeeded
          }
        }
        
        // If all attempts failed, show calm error message
        if (displayError) {
          clearLoadTimeout();
          tsLog('ERROR: All display attempts failed. Last error:', displayError.message);
          showEpubError("This edition couldn't be rendered. Please try another edition.", sourceUrl);
          return;
        }
        
        // Note: timeout is cleared in content hook when first content actually renders
        tsLog('display() promise resolved - waiting for content render');
        
        // Verify content actually rendered - check for iframe with content
        // Use MutationObserver + polling as fallback verification
        setTimeout(function() {
          if (!firstContentRendered && !errorShown) {
            // Check if there's actually an iframe with content
            const viewer = document.getElementById('epub-viewer');
            const iframe = viewer ? viewer.querySelector('iframe') : null;
            const hasContent = iframe && iframe.contentDocument && 
                              iframe.contentDocument.body && 
                              iframe.contentDocument.body.innerHTML.length > 50;
            
            if (hasContent || relocatedFired) {
              tsLog('Content verification: iframe has content or relocated fired - success');
              firstContentRendered = true;
              clearLoadTimeout();
              hideLoading();
            } else {
              tsLog('WARNING: Content verification timeout - no iframe content detected');
              // Give it one more chance with longer wait
              setTimeout(function() {
                if (!firstContentRendered && !errorShown) {
                  tsLog('Final content check failed - trying PDF fallback');
                  clearLoadTimeout();
                  // Try PDF fallback for Archive items before showing error
                  if (archiveId) {
                    tryPdfFallbackWithMessage(archiveId, sourceUrl, currentBestPdf);
                  } else {
                    showEpubError("This edition couldn't be rendered. Please try another edition.", sourceUrl);
                  }
                }
              }, CONTENT_VERIFY_TIMEOUT_MS);
            }
          }
        }, 3000); // Initial check after 3s
        
        // NOW load TOC/navigation AFTER successful display
        // This prevents crashes from malformed EPUBs
        loadNavigationSafely();
        
        tsLog('First page display initiated');
        
      } catch (err) {
        clearLoadTimeout();
        tsLog('ERROR: display() outer catch:', err);
        tsLog('ERROR: display() stack:', err?.stack || '(no stack)');
        const provider = archiveId ? 'archive' : 'unknown';
        showEpubError(`Cannot display this book (${provider}). It may be protected or corrupted.`, sourceUrl);
        return;
      }
      
    } catch (err) {
      clearLoadTimeout();
      tsLog('ERROR: Failed to initialize EPUB:', err);
      
      // Provide more specific error messages
      const errMsg = err.message || String(err);
      if (errMsg.includes('Invalid') || errMsg.includes('indexOf') || errMsg.includes('undefined')) {
        showEpubError('This file is not a valid EPUB. It may be corrupted or in a different format.', sourceUrl);
      } else if (errMsg.includes('network')) {
        showEpubError('Network error while loading book. Please check your connection and try again.', sourceUrl);
      } else {
        showEpubError('Could not load this edition inside BookLantern. Please try a different copy.', sourceUrl);
      }
    }
  }
  
  /**
   * Load navigation/TOC safely AFTER display succeeds
   * This prevents crashes from malformed EPUBs
   */
  function loadNavigationSafely() {
    if (!book) return;
    
    // Wrap book.ready in try/catch (may already be resolved from earlier)
    if (book.ready) {
      book.ready.then(function() {
        tsLog('book.ready resolved (in loadNavigationSafely)');
      }).catch(function(err) {
        tsLog('WARN: book.ready error (non-fatal):', err);
      });
    }
    
    // Wrap book.loaded.navigation
    if (book.loaded && book.loaded.navigation) {
      book.loaded.navigation.then(function() {
        tsLog('Navigation loaded');
        populateTOC();
      }).catch(function(err) {
        tsLog('WARN: Navigation load error (non-fatal):', err);
        // Still try to populate TOC with whatever we have
        populateTOC();
      });
    } else {
      // No navigation promise, try to populate directly
      populateTOC();
    }
    
    // Wrap book.loaded.spine
    if (book.loaded && book.loaded.spine) {
      book.loaded.spine.catch(function(err) {
        tsLog('WARN: Spine error (non-fatal):', err);
      });
    }
  }
  
  /**
   * Update loading message
   */
  function updateLoadingMessage(message) {
    const loadingText = document.querySelector('#epub-loading p');
    if (loadingText) {
      loadingText.textContent = message;
    }
  }
  
  /**
   * Setup EPUB page navigation buttons
   */
  function setupEpubNavigation() {
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    if (prevBtn && rendition) {
      prevBtn.addEventListener('click', function() {
        rendition.prev();
      });
    }
    
    if (nextBtn && rendition) {
      nextBtn.addEventListener('click', function() {
        rendition.next();
      });
    }
  }
  
  /**
   * Setup keyboard navigation for EPUB
   */
  function setupEpubKeyboard() {
    document.addEventListener('keydown', function(e) {
      if (!rendition) return;
      
      // Arrow keys for navigation
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        rendition.prev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        rendition.next();
      } else if (e.key === 'Escape') {
        // Go back
        const backButton = document.querySelector('.reader-back');
        if (backButton) {
          backButton.click();
        }
      }
    });
    
    // Also listen for keydown inside the iframe (ePub.js creates one)
    if (rendition) {
      rendition.on('keydown', function(e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          rendition.prev();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
          rendition.next();
        }
      });
    }
  }
  
  /**
   * Hide loading indicator
   */
  function hideLoading() {
    const loading = document.getElementById('epub-loading');
    if (loading) {
      loading.style.display = 'none';
    }
  }
  
  /**
   * Show error message (prevents duplicate errors)
   * Uses global currentSourceUrl for source link
   */
  function showReaderError(message) {
    if (errorShown) return;
    errorShown = true;
    clearLoadTimeout();
    showEpubError(message, currentSourceUrl);
  }

  /**
   * Show warning banner for very large books (doesn't block loading)
   * @param {number} sizeMB - Book size in megabytes
   * @param {string} sourceUrl - URL to the original source
   */
  function showLargeBookWarning(sizeMB, sourceUrl) {
    const loading = document.getElementById('epub-loading');
    if (!loading) return;
    
    // Check if warning already shown
    if (loading.querySelector('.large-book-warning')) return;
    
    // Only show source link to admins
    const isAdmin = document.body.getAttribute('data-is-admin') === 'true';
    const showSourceLinks = document.body.getAttribute('data-show-source-links') === 'true';
    const sourceLink = (sourceUrl && (isAdmin || showSourceLinks)) 
      ? ` You can also <a href="${sourceUrl}" target="_blank" rel="noopener" style="color: #4f46e5;">view at source</a>.`
      : '';
    
    const warning = document.createElement('div');
    warning.className = 'large-book-warning';
    warning.innerHTML = `
      <p style="color: #b45309; font-size: 14px; margin-top: 16px; padding: 12px; background: #fef3c7; border-radius: 8px;">
        <strong>⚠️ Large book (${sizeMB} MB)</strong><br>
        This book is very large and may take a while to load.${sourceLink}
      </p>
    `;
    loading.appendChild(warning);
  }

  /**
   * Show calm banner when PDF proxy fails
   * Used when both EPUB and PDF fallback fail
   */
  function showPdfProxyError() {
    const viewer = document.getElementById('epub-viewer');
    const loading = document.getElementById('epub-loading');
    
    if (loading) {
      loading.style.display = 'none';
    }
    
    if (viewer) {
      viewer.innerHTML = `
        <div class="reader-error-panel" style="text-align: center; padding: 40px 20px;">
          <svg width="48" height="48" fill="none" stroke="#6b7280" viewBox="0 0 24 24" style="margin: 0 auto 16px;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
          </svg>
          <p style="color: #4b5563; font-size: 16px; margin: 0 0 20px 0;">This edition couldn't be rendered. Please try another edition.</p>
          <button data-action="back" class="reader-error-btn secondary-btn" style="padding: 10px 24px; border-radius: 6px; border: 1px solid #d1d5db; background: #fff; cursor: pointer;">Go Back</button>
        </div>
      `;
      
      // Setup button click handler (CSP-safe)
      const backBtn = viewer.querySelector('[data-action="back"]');
      if (backBtn) {
        backBtn.addEventListener('click', function() {
          window.history.back();
        });
      }
    }
    
    errorShown = true;
  }

  /**
   * Show error message for EPUB loading failures
   * @param {string} message - Error message to display
   * @param {string} sourceUrl - Optional URL to the original source
   */
  function showEpubError(message, sourceUrl) {
    const viewer = document.getElementById('epub-viewer');
    const loading = document.getElementById('epub-loading');
    
    if (loading) {
      loading.style.display = 'none';
    }
    
    // Only show source link to admins or when SHOW_SOURCE_LINKS env is set
    const isAdmin = document.body.getAttribute('data-is-admin') === 'true';
    const showSourceLinks = document.body.getAttribute('data-show-source-links') === 'true';
    
    // Build source link button only for admins or when explicitly enabled
    let sourceButton = '';
    if (sourceUrl && (isAdmin || showSourceLinks)) {
      sourceButton = `<a href="${sourceUrl}" target="_blank" rel="noopener" class="reader-error-btn source-btn">Open Source Link</a>`;
    }
    
    if (viewer) {
      viewer.innerHTML = `
        <div class="reader-error-panel">
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <h3>Unable to load book</h3>
          <p class="error-message">${message}</p>
          <div class="reader-error-actions">
            <button data-action="reload" class="reader-error-btn primary-btn">Try Again</button>
            <button data-action="back" class="reader-error-btn secondary-btn">Go Back</button>
            ${sourceButton}
          </div>
        </div>
      `;
      // Setup button click handlers (CSP-safe, no inline onclick)
      viewer.querySelector('[data-action="reload"]').addEventListener('click', function() {
        window.location.reload();
      });
      viewer.querySelector('[data-action="back"]').addEventListener('click', function() {
        window.history.back();
      });
    }
    
    errorShown = true;
  }

  /**
   * Try to fall back to PDF when EPUB fails (for Archive items)
   * @param {string} archiveId - Archive.org identifier
   * @param {string} sourceUrl - Source URL for error fallback
   * @param {string} [bestPdfFile] - Optional: specific PDF filename to use
   * @returns {Promise<boolean>} true if PDF fallback succeeded
   */
  async function tryPdfFallback(archiveId, sourceUrl, bestPdfFile) {
    if (!archiveId) return false;
    
    tsLog('Attempting PDF fallback for archive:', archiveId, 'bestPdf:', bestPdfFile || '(auto)');
    // Don't update message here - caller should do it for proper UX flow
    
    try {
      // Build token for helper function
      const token = {
        provider: 'archive',
        archive_id: archiveId
      };
      
      // Use helper to get PDF proxy URL with bestPdf if available (deterministic selection)
      const pdfProxyUrl = getPdfRenderUrl(token, bestPdfFile);
      
      if (!pdfProxyUrl) {
        tsLog('PDF fallback: could not build proxy URL');
        return false;
      }
      
      // Check if PDF proxy returns OK
      const headResponse = await fetch(pdfProxyUrl, { method: 'HEAD' });
      
      if (!headResponse.ok) {
        tsLog('PDF fallback HEAD check failed:', headResponse.status);
        // Show calm banner for PDF proxy failure
        showPdfProxyError();
        return false;
      }
      
      tsLog('PDF available, switching to PDF viewer');
      
      // Hide EPUB viewer, show PDF in iframe
      const viewer = document.getElementById('epub-viewer');
      const loading = document.getElementById('epub-loading');
      
      if (loading) {
        loading.style.display = 'none';
      }
      
      if (viewer) {
        // Build "Try EPUB instead" button for manual switching
        const epubButton = `<button id="try-epub-btn" style="margin-left: 12px; padding: 4px 10px; font-size: 12px; background: transparent; border: 1px solid #0369a1; color: #0369a1; border-radius: 4px; cursor: pointer;">Try EPUB instead</button>`;
        
        // Replace viewer content with PDF iframe - calmer messaging
        viewer.innerHTML = `
          <div class="pdf-fallback-container">
            <div class="pdf-fallback-notice">
              <span>📄 Showing PDF version</span>${epubButton}
            </div>
            <iframe 
              class="pdf-fallback-frame" 
              src="${pdfProxyUrl}" 
              title="PDF Viewer"
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              allow="fullscreen"
            ></iframe>
          </div>
        `;
        
        // Setup "Try EPUB instead" click handler
        const tryEpubBtn = document.getElementById('try-epub-btn');
        if (tryEpubBtn) {
          tryEpubBtn.addEventListener('click', function() {
            // Reload page with mode=epub to force EPUB view
            const url = new URL(window.location.href);
            url.searchParams.set('mode', 'epub');
            window.location.href = url.toString();
          });
        }
        
        // Add styles for PDF fallback
        const style = document.createElement('style');
        style.textContent = `
          .pdf-fallback-container {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
          }
          .pdf-fallback-notice {
            background: #e0f2fe;
            color: #0369a1;
            padding: 8px 16px;
            font-size: 13px;
            text-align: center;
            flex-shrink: 0;
          }
          .pdf-fallback-frame {
            flex: 1;
            width: 100%;
            border: none;
            background: #f5f5f5;
          }
        `;
        document.head.appendChild(style);
      }
      
      clearLoadTimeout();
      errorShown = true; // Prevent further error displays
      return true;
    } catch (err) {
      tsLog('PDF fallback error:', err.message);
      return false;
    }
  }

  /**
   * Try PDF fallback with progressive calmer messaging
   * Shows "Preparing book..." initially, then "Switching to PDF version..." on fallback
   * @param {string} archiveId - Archive.org identifier
   * @param {string} sourceUrl - Source URL for final error fallback
   * @param {string} [bestPdfFile] - Optional: specific PDF filename to use
   */
  async function tryPdfFallbackWithMessage(archiveId, sourceUrl, bestPdfFile) {
    if (!archiveId) {
      showEpubError("This edition couldn't be rendered. Please try another edition.", sourceUrl);
      return;
    }
    
    tsLog('Auto-fallback: attempting PDF for archive:', archiveId, 'bestPdf:', bestPdfFile || '(auto)');
    updateLoadingMessage('Switching to PDF version...');
    
    const success = await tryPdfFallback(archiveId, sourceUrl, bestPdfFile);
    if (!success) {
      showEpubError("This edition couldn't be rendered. Please try another edition.", sourceUrl);
    }
  }

  /**
   * Populate the Table of Contents panel
   */
  function populateTOC() {
    const tocList = document.getElementById('toc-list');
    if (!tocList || !book || !book.navigation) return;
    
    try {
      const toc = book.navigation.toc;
      if (!toc || !toc.length) {
        tocList.innerHTML = '<li class="toc-empty">No table of contents available</li>';
        return;
      }
      
      tocList.innerHTML = '';
      
      function renderTocItems(items, depth) {
        items.forEach(function(item) {
          const li = document.createElement('li');
          li.className = 'toc-item' + (depth > 0 ? ' toc-nested' : '');
          li.style.paddingLeft = (depth * 1) + 'rem';
          
          const link = document.createElement('a');
          link.href = '#';
          link.textContent = item.label || 'Untitled';
          link.addEventListener('click', function(e) {
            e.preventDefault();
            if (rendition && item.href) {
              rendition.display(item.href);
              // Close TOC panel on mobile after selection
              const tocPanel = document.getElementById('toc-panel');
              if (tocPanel && window.innerWidth < 768) {
                tocPanel.classList.remove('open');
              }
            }
          });
          
          li.appendChild(link);
          tocList.appendChild(li);
          
          // Render sub-items if present
          if (item.subitems && item.subitems.length) {
            renderTocItems(item.subitems, depth + 1);
          }
        });
      }
      
      renderTocItems(toc, 0);
      tsLog('TOC populated with', toc.length, 'items');
      
      // TASK B: Check if EPUB looks like placeholder (only notice/cover entries)
      checkForPlaceholderEpub(toc);
      
    } catch (err) {
      console.warn('[reader] Failed to populate TOC:', err);
      tocList.innerHTML = '<li class="toc-empty">Could not load table of contents</li>';
    }
  }

  /**
   * Check if EPUB TOC indicates a placeholder/incomplete book
   * If TOC has <=1 entry and it's just "notice" or "cover", switch to PDF
   * @param {Array} toc - The table of contents array
   */
  function checkForPlaceholderEpub(toc) {
    if (!toc || toc.length > 1) return; // More than 1 item = probably real content
    
    // Get best_pdf and archive_id from page data
    const archiveId = document.body.getAttribute('data-archive-id') || 
                      document.getElementById('epub-viewer')?.getAttribute('data-archive-id');
    const bestPdf = document.body.getAttribute('data-best-pdf') || 
                    document.getElementById('epub-viewer')?.getAttribute('data-best-pdf');
    
    if (!archiveId || !bestPdf) {
      tsLog('Placeholder check: no archive/bestPdf available for fallback');
      return;
    }
    
    // Check if the only TOC entry is a placeholder
    const placeholderPatterns = /^(notice|cover|title|copyright|colophon)$/i;
    
    let isPlaceholder = false;
    if (toc.length === 0) {
      isPlaceholder = true;
      tsLog('Placeholder check: TOC is empty');
    } else if (toc.length === 1) {
      const label = (toc[0].label || '').trim().toLowerCase();
      if (placeholderPatterns.test(label) || label.includes('notice') || label.includes('cover')) {
        isPlaceholder = true;
        tsLog('Placeholder check: single TOC entry is placeholder:', label);
      }
    }
    
    if (isPlaceholder) {
      tsLog('EPUB appears to be placeholder-only, switching to PDF');
      
      // Show message and switch to PDF
      const viewer = document.getElementById('epub-viewer');
      if (viewer) {
        // Clear the EPUB rendition
        if (rendition) {
          try { rendition.destroy(); } catch (e) {}
          rendition = null;
        }
        if (book) {
          try { book.destroy(); } catch (e) {}
          book = null;
        }
        
        // Start PDF viewer with message
        startPdfViewerDirectly(archiveId, bestPdf, true, 'This EPUB looks incomplete — showing PDF version');
      }
    }
  }

  /**
   * Enhance back button to use ref parameter if available
   */
  function setupBackButton() {
    const backButton = document.querySelector('.reader-back');
    if (!backButton) return;

    backButton.addEventListener('click', function(e) {
      const ref = this.getAttribute('data-ref');
      
      // If we have a ref parameter, use it
      if (ref && ref.trim()) {
        e.preventDefault();
        
        // Navigate to the ref URL
        if (ref.startsWith('/')) {
          window.location.href = ref;
        } else {
          // Fallback to history.back() if ref is not a path
          window.history.back();
        }
      }
      // Otherwise let the href handle it (no preventDefault)
    });
  }

  /**
   * Setup keyboard shortcuts for better reading experience (iframe mode)
   */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      // Escape key - go back
      if (e.key === 'Escape') {
        const backButton = document.querySelector('.reader-back');
        if (backButton) {
          backButton.click();
        }
      }
    });
  }

  /**
   * Send message to iframe (if needed for future enhancements)
   */
  function sendMessageToFrame(message) {
    const iframe = document.getElementById('reader-frame');
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(message, '*');
      } catch (err) {
        console.warn('Failed to send message to iframe:', err);
      }
    }
  }

  // Expose utilities for debugging
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    window.readerDebug = {
      sendMessageToFrame: sendMessageToFrame,
      getBook: function() { return book; },
      getRendition: function() { return rendition; }
    };
  }

})();
