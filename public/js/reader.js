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
  async function initEpubReader() {
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
      book = ePub(arrayBuffer);
      
      // Render the book into the viewer
      rendition = book.renderTo('epub-viewer', {
        width: '100%',
        height: '100%',
        spread: 'none',
        flow: 'paginated'
      });
      
      // Setup navigation buttons early (before display completes)
      setupEpubNavigation();
      
      // Setup keyboard navigation
      setupEpubKeyboard();
      
      // Display the book starting from the first page
      await rendition.display();
      console.log('[reader] EPUB displayed successfully');
      hideLoading();
      
      // Handle spine loading errors
      book.loaded.spine.catch(err => {
        console.error('[reader] EPUB spine error:', err);
      });
      
    } catch (err) {
      console.error('[reader] Failed to initialize EPUB:', err);
      
      // Provide more specific error messages
      if (err.message && err.message.includes('Invalid')) {
        showEpubError('This file is not a valid EPUB. It may be corrupted or in a different format.');
      } else if (err.message && err.message.includes('network')) {
        showEpubError('Network error while loading book. Please check your connection and try again.');
      } else {
        showEpubError('We couldn\'t load this edition inside BookLantern. Please try a different copy.');
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
          <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="margin-bottom: 1rem; opacity: 0.5;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <p style="font-weight: 600; margin-bottom: 0.5rem;">Unable to load book</p>
          <p style="color: #6b7280; font-size: 0.9rem; margin-bottom: 1.5rem;">${message}</p>
          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center;">
            <button onclick="window.location.reload()" style="background: #4f46e5;">Try Again</button>
            <button onclick="window.history.back()" style="background: #6b7280;">Go Back</button>
          </div>
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
