/**
 * public/js/reader.js - Unified Reader Animation Module
 */

window.BLReader = {
  init(anim) {
    console.log('[BL] reader init');
    
    // Setup neon glass theme
    this.setupNeonTheme();
    
    // Load bookmark assistant
    this.loadBookmarkAssistant(anim);
    
    // Setup loading animation
    this.setupLoadingAnimation(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
    
    // Setup ambient glow
    anim.tryGSAP(() => {
      this.setupAmbientGlow();
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
  
  setupNeonTheme() {
    // Add neon glass styling to reader elements
    const readerContainer = document.querySelector('.reader-container') || document.querySelector('#bookBox');
    if (readerContainer) {
      readerContainer.style.cssText += `
        background: rgba(26, 31, 58, 0.8);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(108, 124, 255, 0.3);
        box-shadow: 0 0 32px rgba(108, 124, 255, 0.2);
      `;
    }
  },
  
  setupAmbientGlow() {
    if (!window.gsap) return;
    
    // Create ambient glow effect
    const glowOverlay = document.createElement('div');
    glowOverlay.className = 'ambient-glow';
    glowOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle at 50% 50%, rgba(108, 124, 255, 0.05) 0%, transparent 70%);
      pointer-events: none;
      z-index: -1;
    `;
    document.body.appendChild(glowOverlay);
    
    // Subtle pulse animation
    gsap.to(glowOverlay, {
      opacity: 0.8,
      duration: 3,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });
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