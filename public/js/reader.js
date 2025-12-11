// public/js/reader.js - Unified reader JavaScript with ePub.js support
(function() {
  'use strict';

  // State for ePub.js reader
  let book = null;
  let rendition = null;

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
      // Initialize ePub.js renderer
      initEpubReader();
    } else {
      // Setup keyboard shortcuts for iframe
      setupKeyboardShortcuts();
    }
  }

  /**
   * Initialize ePub.js reader
   */
  function initEpubReader() {
    const viewer = document.getElementById('epub-viewer');
    const loading = document.getElementById('epub-loading');
    
    if (!viewer) {
      console.error('[reader] epub-viewer element not found');
      return;
    }
    
    const epubUrl = viewer.getAttribute('data-epub-url');
    if (!epubUrl) {
      console.error('[reader] No EPUB URL provided');
      showEpubError('No book URL provided');
      return;
    }
    
    console.log('[reader] Loading EPUB from:', epubUrl);
    
    // Check if ePub.js is loaded
    if (typeof ePub === 'undefined') {
      console.error('[reader] ePub.js library not loaded');
      showEpubError('Reader library failed to load. Please refresh the page.');
      return;
    }
    
    try {
      // Proxy the EPUB URL to avoid CORS issues
      const proxiedUrl = '/api/proxy/epub?url=' + encodeURIComponent(epubUrl);
      console.log('[reader] Using proxied URL:', proxiedUrl);
      
      // Initialize the book
      book = ePub(proxiedUrl);
      
      // Render the book into the viewer
      rendition = book.renderTo('epub-viewer', {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated'
      });
      
      // Display the book starting from the first page
      rendition.display().then(() => {
        console.log('[reader] EPUB displayed successfully');
        hideLoading();
      }).catch(err => {
        console.error('[reader] Failed to display EPUB:', err);
        showEpubError('Failed to display book content. The file may be corrupted or unavailable.');
      });
      
      // Setup navigation buttons
      setupEpubNavigation();
      
      // Setup keyboard navigation
      setupEpubKeyboard();
      
      // Handle loading errors
      book.loaded.spine.catch(err => {
        console.error('[reader] EPUB spine error:', err);
      });
      
    } catch (err) {
      console.error('[reader] Failed to initialize EPUB:', err);
      showEpubError('Failed to load book. Please try again later.');
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
   * Show error message
   */
  function showEpubError(message) {
    const viewer = document.getElementById('epub-viewer');
    const loading = document.getElementById('epub-loading');
    
    if (loading) {
      loading.style.display = 'none';
    }
    
    if (viewer) {
      viewer.innerHTML = `
        <div class="reader-error">
          <p>Unable to load book content.</p>
          <p>${message}</p>
          <button onclick="window.history.back()">Go Back</button>
        </div>
      `;
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
