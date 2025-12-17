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
      // Log full error details including stack trace
      console.error('[reader] window.onerror:', {
        message: msg,
        source: source || '(unknown source)',
        line: lineno,
        column: colno,
        stack: error?.stack || '(no stack)',
        error: error
      });
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
      // Log full rejection details including stack trace
      console.error('[reader] window.onunhandledrejection:', {
        reason: reason,
        stack: event.reason?.stack || '(no stack)',
        promise: event.promise,
        error: event.reason
      });
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
    
    if (isEpubPage) {
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
    } else {
      // Setup keyboard shortcuts for iframe
      setupKeyboardShortcuts();
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
      console.log('[reader] font size ->', currentFontSize + '%');
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
    console.log('[reader] JSZip available:', typeof JSZip !== 'undefined');
    
    if (!viewer) {
      console.error('[reader] epub-viewer element not found');
      return;
    }
    
    const epubUrl = viewer.getAttribute('data-epub-url');
    const archiveId = viewer.getAttribute('data-archive-id');
    const directUrl = viewer.getAttribute('data-direct-url') || '';
    const sourceUrl = viewer.getAttribute('data-source-url') || directUrl;
    
    // Store URLs globally for error handlers
    currentDirectUrl = directUrl;
    currentSourceUrl = sourceUrl;
    
    if (!epubUrl) {
      console.error('[reader] No EPUB URL provided');
      showEpubError('No book URL provided', sourceUrl);
      return;
    }
    
    // Generate stable book key for persistence
    bookKey = generateBookKey(epubUrl, archiveId);
    console.log('[reader] Book key:', bookKey);
    
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
    
    console.log('[reader] Loading EPUB from:', epubUrl);
    
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
        showEpubError('Book is taking too long to load. It may be too large or corrupted.', sourceUrl);
      }
    }, currentTimeout);
    
    try {
      // Proxy the EPUB URL to avoid CORS issues
      // Prefer explicit archive_id from token; otherwise detect archive URLs
      let proxiedUrl;
      if (archiveId) {
        proxiedUrl = '/api/proxy/epub?archive=' + encodeURIComponent(archiveId);
        console.log('[reader] Using archive mode via token archive_id:', proxiedUrl);
      } else {
        const archiveMatch = epubUrl.match(/archive\.org\/download\/([^\/]+)/);
        if (archiveMatch) {
          // Use archive parameter for better metadata-based file selection
          proxiedUrl = '/api/proxy/epub?archive=' + encodeURIComponent(archiveMatch[1]);
          console.log('[reader] Using archive mode (URL detection):', proxiedUrl);
        } else {
          proxiedUrl = '/api/proxy/epub?url=' + encodeURIComponent(epubUrl);
          console.log('[reader] Using proxied URL:', proxiedUrl);
        }
      }
      
      // Update loading message
      console.log('[reader] Download started');
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
      console.log('[reader] Proxy response:', response.status, 'Content-Type:', response.headers.get('content-type'), 'Size:', bookSizeBytes, 'bytes');
      
      // Adjust timeout based on book size
      if (bookSizeBytes > 0) {
        clearLoadTimeout();
        currentTimeout = calculateTimeout(bookSizeBytes);
        console.log('[reader] Adjusted timeout:', Math.round(currentTimeout/1000), 'seconds for', Math.round(bookSizeBytes/1e6), 'MB');
        loadTimeoutId = setTimeout(function() {
          if (!errorShown) {
            console.error('[reader] Load timeout exceeded after', currentTimeout, 'ms');
            clearLoadTimeout();
            showEpubError('Book is taking too long to load. It may be too large or corrupted.', sourceUrl);
          }
        }, currentTimeout);
        
        // Show warning for very large books
        if (bookSizeBytes > LARGE_BOOK_THRESHOLD) {
          const sizeMB = Math.round(bookSizeBytes / 1e6);
          console.warn('[reader] Very large book detected:', sizeMB, 'MB');
          updateLoadingMessage(`Downloading large book (${sizeMB} MB)... This may take a while.`);
          showLargeBookWarning(sizeMB, sourceUrl);
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
          // Protected/borrow-only - ALWAYS show Open Source Link
          clearLoadTimeout();
          const borrowMsg = errorDetail === 'borrow_required' 
            ? 'This book requires borrowing from the source library.'
            : 'This book is protected or restricted. Use the link below to access it directly.';
          showEpubError(borrowMsg, errorSourceUrl);
          return;
        } else if (response.status === 401) {
          showEpubError('Please log in to read books.', errorSourceUrl);
        } else {
          showEpubError('Failed to download book. Please try again later.', errorSourceUrl);
        }
        return;
      }
      
      // Get the ArrayBuffer
      console.log('[reader] Download complete, processing...');
      updateLoadingMessage('Processing book...');
      const arrayBuffer = await response.arrayBuffer();
      
      if (!arrayBuffer || arrayBuffer.byteLength < 100) {
        console.error('[reader] EPUB file too small or empty:', arrayBuffer?.byteLength);
        showEpubError('The book file appears to be empty or corrupted.', sourceUrl);
        return;
      }
      
      console.log('[reader] Downloaded EPUB, size:', arrayBuffer.byteLength, 'bytes');
      
      // Validate ZIP signature (EPUB must be a ZIP file starting with 'PK')
      const header = new Uint8Array(arrayBuffer.slice(0, 4));
      const isZip = header[0] === 0x50 && header[1] === 0x4B; // 'PK'
      if (!isZip) {
        console.error('[reader] File is not a valid ZIP/EPUB (header:', header, ')');
        clearLoadTimeout();
        showEpubError('This file is not a valid EPUB. It may be an HTML page or different format.', sourceUrl);
        return;
      }
      console.log('[reader] ZIP signature validated');
      
      // Validate EPUB structure: must contain META-INF/container.xml and valid OPF
      console.log('[reader] Unzip started');
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
          console.error('[reader] Missing META-INF/container.xml - not a valid EPUB');
          clearLoadTimeout();
          showEpubError('This file is not a valid EPUB (missing container.xml). Try another edition.', sourceUrl);
          return;
        }
        console.log('[reader] container.xml found at:', containerXmlKey);
        
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
          console.warn('[reader] Could not parse container.xml:', parseErr);
        }
        
        if (!opfPath) {
          console.error('[reader] Could not extract rootfile path from container.xml');
          clearLoadTimeout();
          showEpubError('Invalid EPUB structure (no rootfile in container.xml). Try another edition.', sourceUrl);
          return;
        }
        console.log('[reader] OPF path from container.xml:', opfPath);
        
        // Verify the OPF file exists in the zip (case-insensitive)
        var opfExists = false;
        for (var key in zip.files) {
          if (key.toLowerCase() === opfPath.toLowerCase()) {
            opfExists = true;
            console.log('[reader] OPF file found at:', key);
            break;
          }
        }
        
        if (!opfExists) {
          console.error('[reader] OPF file not found in ZIP:', opfPath);
          clearLoadTimeout();
          showEpubError('Invalid EPUB structure (OPF file not found). Try another edition.', sourceUrl);
          return;
        }
        
        console.log('[reader] EPUB structure validated successfully');
      } catch (zipErr) {
        console.error('[reader] JSZip validation failed:', zipErr);
        clearLoadTimeout();
        showEpubError('Failed to validate EPUB structure. The file may be corrupted.', sourceUrl);
        return;
      }
      
      // Open EPUB via ArrayBuffer
      updateLoadingMessage('Opening book...');
      
      try {
        // Open epub.js with ArrayBuffer directly
        book = ePub(arrayBuffer);
      } catch (err) {
        clearLoadTimeout();
        console.error('[reader] ePub() constructor failed:', err);
        showEpubError('Invalid EPUB format. This file cannot be opened in the reader.', sourceUrl);
        return;
      }
      
      // Render the book into the viewer
      // Use scrolled-doc flow for better mobile experience
      try {
        rendition = book.renderTo('epub-viewer', {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'scrolled-doc',
          allowScriptedContent: false
        });
      } catch (err) {
        clearLoadTimeout();
        console.error('[reader] renderTo() failed:', err);
        showEpubError('Failed to render book. It may be corrupted or in an unsupported format.', sourceUrl);
        return;
      }
      
      // Use content hooks to inject styles inline (avoids CSP blob: stylesheet issues)
      rendition.hooks.content.register(function(contents) {
        try {
          // Add error handlers inside the EPUB iframe
          contents.window.addEventListener('error', function(e) {
            console.error('[reader] iframe error:', e.message);
            clearLoadTimeout();
            showEpubError("This book can't be opened in the reader. Try another edition.", currentSourceUrl);
          });
          contents.window.addEventListener('unhandledrejection', function(e) {
            console.error('[reader] iframe rejection:', e.reason);
            clearLoadTimeout();
            showEpubError("This book can't be opened in the reader. Try another edition.", currentSourceUrl);
          });
          
          // Inject default theme styles inline
          contents.addStylesheetRules(DEFAULT_READER_THEME);
          
          // Apply font size inline
          contents.document.documentElement.style.fontSize = currentFontSize + '%';
          if (contents.document.body) {
            contents.document.body.style.fontSize = currentFontSize + '%';
          }
          console.log('[reader] Content hook: styles applied, font size:', currentFontSize + '%');
        } catch (err) {
          console.warn('[reader] Content hook error:', err);
        }
      });
      
      // Setup navigation buttons early (before display completes)
      setupEpubNavigation();
      
      // Setup keyboard navigation
      setupEpubKeyboard();
      
      // Track location changes for persistence and re-apply font size
      rendition.on('relocated', function(location) {
        if (location && location.start && location.start.cfi) {
          saveLocation(location.start.cfi);
        }
        // Re-apply font size on navigation
        applyFontSize();
      });
      
      // Re-apply font size when new content is rendered
      rendition.on('rendered', function() {
        applyFontSize();
      });
      
      // Display the book - try to restore saved location
      try {
        const savedLocation = getSavedLocation();
        if (savedLocation) {
          console.log('[reader] Restoring saved location:', savedLocation);
          await rendition.display(savedLocation);
        } else {
          await rendition.display();
        }
        
        // Clear timeout on success
        clearLoadTimeout();
        console.log('[reader] EPUB displayed successfully');
        hideLoading();
        
        // NOW load TOC/navigation AFTER successful display
        // This prevents crashes from malformed EPUBs
        loadNavigationSafely();
        
        console.log('[reader] First page displayed successfully');
        
      } catch (err) {
        clearLoadTimeout();
        console.error('[reader] display() failed:', err);
        showEpubError('Cannot display this book. It may be protected or corrupted.', sourceUrl);
        return;
      }
      
    } catch (err) {
      clearLoadTimeout();
      console.error('[reader] Failed to initialize EPUB:', err);
      
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
    
    // Wrap book.ready in try/catch
    if (book.ready) {
      book.ready.then(function() {
        console.log('[reader] book.ready resolved');
      }).catch(function(err) {
        console.warn('[reader] book.ready error (non-fatal):', err);
      });
    }
    
    // Wrap book.loaded.navigation
    if (book.loaded && book.loaded.navigation) {
      book.loaded.navigation.then(function() {
        console.log('[reader] Navigation loaded');
        populateTOC();
      }).catch(function(err) {
        console.warn('[reader] Navigation load error (non-fatal):', err);
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
        console.warn('[reader] Spine error (non-fatal):', err);
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
    
    const warning = document.createElement('div');
    warning.className = 'large-book-warning';
    warning.innerHTML = `
      <p style="color: #b45309; font-size: 14px; margin-top: 16px; padding: 12px; background: #fef3c7; border-radius: 8px;">
        <strong>⚠️ Large book (${sizeMB} MB)</strong><br>
        This book is very large and may not load in-browser. If it fails, you can 
        <a href="${sourceUrl || '#'}" target="_blank" rel="noopener" style="color: #4f46e5;">open it at the source</a>.
      </p>
    `;
    loading.appendChild(warning);
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
    
    // Build source link button if we have a URL
    let sourceButton = '';
    if (sourceUrl) {
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
            <button onclick="window.location.reload()" class="reader-error-btn primary-btn">Try Again</button>
            <button onclick="window.history.back()" class="reader-error-btn secondary-btn">Go Back</button>
            ${sourceButton}
          </div>
        </div>
      `;
    }
    
    errorShown = true;
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
      console.log('[reader] TOC populated with', toc.length, 'items');
      
    } catch (err) {
      console.warn('[reader] Failed to populate TOC:', err);
      tocList.innerHTML = '<li class="toc-empty">Could not load table of contents</li>';
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
