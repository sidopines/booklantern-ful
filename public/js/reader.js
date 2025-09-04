/**
 * public/js/reader.js - Unified Reader Animation Module
 */

window.BLReader = {
  init(anim) {
    console.log('[BL] reader init');
    
    // Load bookmark assistant
    this.loadBookmarkAssistant(anim);
    
    // Setup loading animation
    this.setupLoadingAnimation(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
  },
  
  loadBookmarkAssistant(anim) {
    const assistant = document.getElementById('bookmark-assistant');
    if (!assistant) return;
    
    anim.tryLottie('bookmark-assistant', '/public/animations/bookmark.json', {
      loop: true,
      autoplay: true
    });
  },
  
  setupLoadingAnimation(anim) {
    const loadingStack = document.getElementById('loading-stack');
    if (!loadingStack) return;
    
    // Show loading animation
    loadingStack.style.display = 'flex';
    
    // Hide loading after content is ready or timeout
    const hideLoading = () => {
      loadingStack.style.display = 'none';
      document.querySelector('.muted').style.display = 'none';
    };
    
    // Listen for reader ready event
    document.addEventListener('readerReady', hideLoading);
    
    // Fallback timeout
    setTimeout(hideLoading, 60000);
  },
  
  setupGSAPAnimations() {
    if (!window.gsap) return;
    
    // Reader chrome animations
    gsap.timeline()
      .from('.reader-header', { opacity: 0, y: -20, duration: 0.8 })
      .from('.reader-controls', { opacity: 0, y: 20, duration: 0.8 }, '-=0.4')
      .from('#bookBox', { opacity: 0, scale: 0.95, duration: 1 }, '-=0.6');
    
    // Loading stack animation
    const loadingBooks = document.querySelectorAll('.loading-book');
    loadingBooks.forEach((book, i) => {
      gsap.to(book, {
        y: -10,
        duration: 0.8,
        repeat: -1,
        yoyo: true,
        delay: i * 0.2,
        ease: 'power2.inOut'
      });
    });
  }
};