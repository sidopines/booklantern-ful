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

  // Timeout for book loading (15 seconds)
  const LOAD_TIMEOUT_MS = 15000;

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

  // Global error handlers to catch any unhandled errors
  window.addEventListener('error', function(event) {
    if (!errorShown && event.message && (event.message.includes('epub') || event.message.includes('indexOf'))) {
      console.error('[reader] Global error:', event.error || event.message);
      showReaderError('An error occurred while loading the book. It may be corrupted or incompatible.');
    }
  });

  window.addEventListener('unhandledrejection', function(event) {
    if (!errorShown) {
      const reason = event.reason?.message || String(event.reason);
      console.error('[reader] Unhandled rejection:', reason);
      // Catch common epub.js errors
      if (reason.includes('indexOf') || reason.includes('undefined') || reason.includes('null')) {
        showReaderError('This book has an unsupported structure. Please try a different edition.');
      } else {
        showReaderError('Failed to process book file. Please try a different edition.');
      }
    }
  });

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
   * Change font size
   */
  function changeFontSize(delta) {
    currentFontSize = Math.max(70, Math.min(150, currentFontSize + delta));
    
    if (rendition) {
      rendition.themes.fontSize(currentFontSize + '%');
    }
    
    // Update display
    const fontDisplay = document.getElementById('font-size-display');
    if (fontDisplay) {
      fontDisplay.textContent = currentFontSize + '%';
    }
    
    // Save preference
    try {
      localStorage.setItem('bl-reader-fontsize', currentFontSize);
    } catch (e) {}
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
    
    if (!epubUrl) {
      console.error('[reader] No EPUB URL provided');
      showEpubError('No book URL provided', directUrl);
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
      showEpubError('Reader library failed to load. Please refresh the page.', directUrl);
      return;
    }
    
    // Start timeout watchdog
    loadTimeoutId = setTimeout(function() {
      if (!errorShown) {
        console.error('[reader] Load timeout exceeded');
        showEpubError('Book is taking too long to load. It may be too large or corrupted.', directUrl);
      }
    }, LOAD_TIMEOUT_MS);
    
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
      updateLoadingMessage('Downloading book...');
      
      // Fetch the EPUB as an ArrayBuffer
      // Include credentials to maintain session for gating
      const response = await fetch(proxiedUrl, {
        credentials: 'include'
      });
      
      // Log response details for debugging
      console.log('[reader] Proxy response:', response.status, response.headers.get('content-type'));
      
      if (!response.ok) {
        let errorDetail = '';
        try {
          const errorJson = await response.json();
          errorDetail = errorJson.error || '';
        } catch {
          errorDetail = await response.text().catch(() => '');
        }
        console.error('[reader] Proxy fetch failed:', response.status, errorDetail);
        
        if (response.status === 403) {
          showEpubError('This book source is not supported. Please try a different edition.');
        } else if (response.status === 404) {
          showEpubError('Book file not found. The source may have moved or been removed.');
        } else if (response.status === 504) {
          showEpubError('Download timed out. Please try again later.');
        } else if (response.status === 502) {
          showEpubError('Could not fetch book from source. ' + (errorDetail || 'Please try again later.'));
        } else if (response.status === 422 || response.status === 409) {
          showEpubError('This book appears to be protected (DRM/LCP) and cannot be opened in the BookLantern reader yet. Please try another edition.');
        } else if (response.status === 401) {
          showEpubError('Please log in to read books.');
        } else {
          showEpubError('Failed to download book. Please try again later.');
        }
        return;
      }
      
      // Get the ArrayBuffer
      updateLoadingMessage('Processing book...');
      const arrayBuffer = await response.arrayBuffer();
      
      if (!arrayBuffer || arrayBuffer.byteLength < 100) {
        console.error('[reader] EPUB file too small or empty:', arrayBuffer?.byteLength);
        showEpubError('The book file appears to be empty or corrupted.');
        return;
      }
      
      console.log('[reader] Downloaded EPUB, size:', arrayBuffer.byteLength, 'bytes');
      
      // Initialize the book with the ArrayBuffer
      // ePub.js can accept an ArrayBuffer directly
      updateLoadingMessage('Opening book...');
      
      try {
        book = ePub(arrayBuffer);
      } catch (err) {
        clearTimeout(loadTimeoutId);
        console.error('[reader] ePub() constructor failed:', err);
        showEpubError('Invalid EPUB format. This file cannot be opened in the reader.', directUrl);
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
        clearTimeout(loadTimeoutId);
        console.error('[reader] renderTo() failed:', err);
        showEpubError('Failed to render book. It may be corrupted or in an unsupported format.', directUrl);
        return;
      }
      
      // Register and apply default theme for proper typography
      try {
        rendition.themes.register('default', DEFAULT_READER_THEME);
        rendition.themes.select('default');
        rendition.themes.fontSize(currentFontSize + '%');
        console.log('[reader] Default theme applied');
      } catch (err) {
        console.warn('[reader] Theme registration failed:', err);
      }
      
      // Setup navigation buttons early (before display completes)
      setupEpubNavigation();
      
      // Setup keyboard navigation
      setupEpubKeyboard();
      
      // Track location changes for persistence
      rendition.on('relocated', function(location) {
        if (location && location.start && location.start.cfi) {
          saveLocation(location.start.cfi);
        }
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
        clearTimeout(loadTimeoutId);
        console.log('[reader] EPUB displayed successfully');
        hideLoading();
        
        // Populate TOC
        populateTOC();
        
      } catch (err) {
        clearTimeout(loadTimeoutId);
        console.error('[reader] display() failed:', err);
        showEpubError('Cannot display this book. It may be protected or corrupted.', directUrl);
        return;
      }
      
      // Handle spine loading errors
      if (book.loaded && book.loaded.spine) {
        book.loaded.spine.catch(err => {
          clearTimeout(loadTimeoutId);
          console.error('[reader] EPUB spine error:', err);
          if (!errorShown) {
            showEpubError('Book structure is invalid. Please try a different edition.', directUrl);
          }
        });
      }
      
    } catch (err) {
      clearTimeout(loadTimeoutId);
      console.error('[reader] Failed to initialize EPUB:', err);
      
      // Provide more specific error messages
      if (err.message && err.message.includes('Invalid')) {
        showEpubError('This file is not a valid EPUB. It may be corrupted or in a different format.', directUrl);
      } else if (err.message && err.message.includes('network')) {
        showEpubError('Network error while loading book. Please check your connection and try again.', directUrl);
      } else {
        showEpubError('We couldn\'t load this edition inside BookLantern. Please try a different copy.', directUrl);
      }
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
   */
  function showReaderError(message) {
    if (errorShown) return;
    errorShown = true;
    showEpubError(message);
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
