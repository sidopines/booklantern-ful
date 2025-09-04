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
    if (!loadingStack) {
      // Create book stack loader if it doesn't exist
      this.createBookStackLoader();
    }
    
    // Show loading animation
    if (loadingStack) {
      loadingStack.style.display = 'flex';
    }
    
    // Hide loading after content is ready or timeout
    const hideLoading = () => {
      if (loadingStack) {
        loadingStack.style.display = 'none';
      }
      const muted = document.querySelector('.muted');
      if (muted) {
        muted.style.display = 'none';
      }
    };
    
    // Listen for reader ready event
    document.addEventListener('readerReady', hideLoading);
    
    // Fallback timeout
    setTimeout(hideLoading, 60000);
  },
  
  createBookStackLoader() {
    const readerContainer = document.querySelector('.reader-container') || document.querySelector('#bookBox');
    if (!readerContainer) return;
    
    const loadingStack = document.createElement('div');
    loadingStack.id = 'loading-stack';
    loadingStack.className = 'book-stack-loader';
    loadingStack.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      z-index: 1000;
      background: var(--glass-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-xl);
      padding: 2rem;
      box-shadow: var(--shadow-glow);
    `;
    
    // Create animated book stack
    for (let i = 0; i < 5; i++) {
      const book = document.createElement('div');
      book.className = 'stack-book';
      book.style.cssText = `
        width: 60px;
        height: 80px;
        background: var(--gradient-primary);
        border-radius: 4px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        transform: translateX(${i * 2}px) translateY(${i * -2}px);
        animation: book-stack-float 2s ease-in-out infinite;
        animation-delay: ${i * 0.1}s;
      `;
      loadingStack.appendChild(book);
    }
    
    // Add loading text
    const loadingText = document.createElement('div');
    loadingText.textContent = 'Loading your book...';
    loadingText.style.cssText = `
      color: var(--text);
      font-size: 1.1rem;
      font-weight: 500;
      margin-top: 1rem;
      text-align: center;
    `;
    loadingStack.appendChild(loadingText);
    
    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes book-stack-float {
        0%, 100% { transform: translateX(0) translateY(0) rotate(0deg); }
        50% { transform: translateX(5px) translateY(-5px) rotate(2deg); }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(loadingStack);
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
    
    // Create reading lamp ambient glow
    const glowOverlay = document.createElement('div');
    glowOverlay.className = 'ambient-glow';
    glowOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(ellipse at center top, 
        rgba(245, 158, 11, 0.08) 0%, 
        rgba(99, 102, 241, 0.05) 30%, 
        transparent 70%);
      pointer-events: none;
      z-index: -1;
    `;
    document.body.appendChild(glowOverlay);
    
    // Gentle breathing glow animation
    gsap.to(glowOverlay, {
      opacity: 0.6,
      duration: 4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut"
    });
    
    // Create floating dust particles in reader
    this.createReaderDustParticles();
  },
  
  createReaderDustParticles() {
    const readerContainer = document.querySelector('.reader-container') || document.querySelector('#bookBox');
    if (!readerContainer) return;
    
    for (let i = 0; i < 8; i++) {
      const particle = document.createElement('div');
      particle.className = 'dust-particle';
      particle.style.cssText = `
        position: absolute;
        width: 2px;
        height: 2px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        pointer-events: none;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
        animation: dust-drift 20s infinite linear;
        animation-delay: ${Math.random() * 5}s;
      `;
      readerContainer.appendChild(particle);
    }
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