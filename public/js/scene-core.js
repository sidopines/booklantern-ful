/**
 * public/js/scene-core.js - Progressive WebGL Animation Boot System
 * Lusion-inspired cinematic experience with graceful fallbacks
 */

window.BL = window.BL || {};

BL.anim = {
  ready: false,
  webglSupported: false,
  reducedMotion: false,
  
  wantsMotion() {
    const force = localStorage.getItem('bl:anim:force'); // 'on'|'off'|null
    if (force === 'on') return true;
    if (force === 'off') return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
  
  detectWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      return !!gl;
    } catch (e) {
      return false;
    }
  },
  
  boot(page) {
    if (this.ready) return;
    this.ready = true;
    
    // Detect capabilities
    this.webglSupported = this.detectWebGL();
    this.reducedMotion = !this.wantsMotion();
    
    document.documentElement.classList.add('bl-booted');
    console.log('[BL] anim boot', { 
      buildId: window.BL_BUILD_ID || 'unknown',
      page: page || document.body.dataset.page || 'unknown',
      wantsMotion: this.wantsMotion(), 
      webglSupported: this.webglSupported,
      reducedMotion: this.reducedMotion 
    });
    
    // Wait for fallback libraries if needed
    if (this.wantsMotion()) {
      this.waitForLibraries().then(() => {
        this.initializeLibraries();
      });
    } else {
      this.initializeLibraries();
    }
  },
  
  async waitForLibraries() {
    const maxWait = 2000; // 2 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      if (window.THREE && window.gsap && window.lottie && window.Lenis) {
        console.log('[BL] all libraries loaded');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.warn('[BL] some libraries not loaded after 2s, continuing with fallbacks');
  },
  
  initializeLibraries() {
    // Initialize smooth scroll if motion allowed
    if (this.wantsMotion() && window.Lenis) {
      try {
        const lenis = new Lenis({ 
          smoothWheel: true,
          duration: 1.2,
          easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))
        });
        
        function raf(time) { 
          lenis.raf(time); 
          requestAnimationFrame(raf); 
        }
        requestAnimationFrame(raf);
        console.log('[BL] lenis ok');
      } catch (e) {
        console.warn('[BL] lenis failed:', e);
      }
    }
    
    // Initialize page-specific modules
    const page = document.body.dataset.page || '';
    this.initPage(page);
    
    // Handle tab visibility for performance
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseAll();
      } else {
        this.resumeAll();
      }
    });
  },
  
  initPage(page) {
    try {
      if (page === 'home' && window.BLHome) {
        BLHome.init(this);
        console.log('[BL] page home ready');
      }
      if (page === 'read' && window.BLRead) {
        BLRead.init(this);
        console.log('[BL] page read ready');
      }
      if (page === 'reader' && window.BLReader) {
        BLReader.init(this);
        console.log('[BL] page reader ready');
      }
      if (page === 'watch' && window.BLWatch) {
        BLWatch.init(this);
        console.log('[BL] page watch ready');
      }
      if (page === 'about' && window.BLAbout) {
        BLAbout.init(this);
        console.log('[BL] page about ready');
      }
      if (page === 'contact' && window.BLContact) {
        BLContact.init(this);
        console.log('[BL] page contact ready');
      }
      if (page === 'dashboard' && window.BLDesk) {
        BLDesk.init(this);
        console.log('[BL] page dashboard ready');
      }
    } catch (e) {
      console.error('[BL] page init error', e);
    }
  },
  
  pauseAll() {
    // Pause all animations when tab is hidden
    if (window.gsap) {
      gsap.globalTimeline.pause();
    }
    if (window.lottie) {
      lottie.getRegisteredAnimations().forEach(anim => anim.pause());
    }
  },
  
  resumeAll() {
    // Resume animations when tab becomes visible
    if (window.gsap) {
      gsap.globalTimeline.resume();
    }
    if (window.lottie) {
      lottie.getRegisteredAnimations().forEach(anim => anim.play());
    }
  },
  
  toggle() {
    const current = localStorage.getItem('bl:anim:force');
    const newValue = current === 'on' ? 'off' : 'on';
    localStorage.setItem('bl:anim:force', newValue);
    window.location.reload();
  },
  
  // Helper methods for page modules
  tryLottie(containerId, animationPath, options = {}) {
    if (!this.wantsMotion() && !options.allowReducedMotion) {
      return this.createStaticFallback(containerId, animationPath);
    }
    
    try {
      if (!window.lottie) {
        console.warn('[BL] lottie not loaded, using fallback');
        return this.createStaticFallback(containerId, animationPath);
      }
      
      const container = document.getElementById(containerId);
      if (!container) {
        console.warn(`[BL] container ${containerId} not found`);
        return null;
      }
      
      const animation = lottie.loadAnimation({
        container,
        renderer: 'svg',
        loop: options.loop !== false,
        autoplay: options.autoplay !== false,
        path: animationPath,
        ...options
      });
      
      console.log(`[BL] lottie ok ${containerId}`);
      return animation;
    } catch (error) {
      console.warn('[BL] lottie failed:', error);
      return this.createStaticFallback(containerId, animationPath);
    }
  },
  
  tryGSAP(callback) {
    if (!this.wantsMotion()) return;
    
    try {
      if (!window.gsap) {
        console.warn('[BL] gsap not loaded');
        return;
      }
      callback();
      console.log('[BL] gsap ok');
    } catch (error) {
      console.warn('[BL] gsap failed:', error);
    }
  },
  
  tryThreeJS(callback) {
    if (!this.wantsMotion() || !this.webglSupported) return;
    
    try {
      if (!window.THREE) {
        console.warn('[BL] three.js not loaded');
        return;
      }
      callback();
      console.log('[BL] three.js ok');
    } catch (error) {
      console.warn('[BL] three.js failed:', error);
    }
  },
  
  createStaticFallback(containerId, animationPath) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    
    // Extract animation name from path for fallback icon
    const animationName = animationPath.split('/').pop().replace('.json', '');
    const fallbackIcons = {
      'library-doors': '🚪',
      'reading-hero': '📖',
      'reading-desk': '🪑',
      'side-cat': '🐱',
      'page-flip': '📄',
      'magnifier': '🔍',
      'books': '📚',
      'bookmark': '🔖',
      'curtain': '🎭',
      'candle': '🕯️',
      'pen-writing': '✍️',
      'flame': '🔥',
      'hero-fallback': '✨'
    };
    
    const icon = fallbackIcons[animationName] || '✨';
    
    container.innerHTML = `
      <div class="static-fallback" style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        font-size: 3rem;
        opacity: 0.7;
        color: var(--primary);
      ">
        ${icon}
      </div>
    `;
    
    return { type: 'static-fallback', container };
  }
};

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page || '';
  BL.anim.boot(page);
});

// Animation toggle function for nav
window.toggleAnimations = () => BL.anim.toggle();

console.log('[BL] scene-core loaded');