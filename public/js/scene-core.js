/**
 * public/js/scene-core.js - Robust Animation Boot System
 * Handles all animations with graceful fallbacks and user preferences
 */

window.BL = window.BL || {};

BL.anim = {
  ready: false,
  
  wantsMotion() {
    const force = localStorage.getItem('bl:anim:force'); // 'on'|'off'|null
    if (force === 'on') return true;
    if (force === 'off') return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
  
  boot() {
    if (this.ready) return;
    this.ready = true;
    
    document.documentElement.classList.add('bl-booted');
    console.log('[BL] anim boot', { wantsMotion: this.wantsMotion() });
    
    // Lenis smooth scroll if motion allowed
    if (this.wantsMotion() && window.Lenis) {
      try {
        const lenis = new Lenis({ smoothWheel: true });
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
    
    // Page inits
    const page = document.body.dataset.page || '';
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
    if (!this.wantsMotion()) return;
    
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
      'flame': '🔥'
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
      ">
        ${icon}
      </div>
    `;
    
    return { type: 'static-fallback', container };
  }
};

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => BL.anim.boot());

// Animation toggle function for nav
window.toggleAnimations = function() {
  const current = localStorage.getItem('bl:anim:force');
  const newValue = current === 'on' ? 'off' : 'on';
  localStorage.setItem('bl:anim:force', newValue);
  window.location.reload();
};

console.log('[BL] scene-core loaded');