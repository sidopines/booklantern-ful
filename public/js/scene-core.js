/**
 * SceneManager - Central animation boot system
 * Handles progressive enhancement: WebGL → Lottie → SVG
 * Manages scroll lock/unlock and scene routing
 */

class SceneManager {
  constructor() {
    this.currentScene = null;
    this.sceneControllers = new Map();
    this.isBooted = false;
    this.isScrollLocked = true;
    this.readyCallbacks = [];
    
    // Bind methods
    this.boot = this.boot.bind(this);
    this.route = this.route.bind(this);
    this.ready = this.ready.bind(this);
    this.lockScroll = this.lockScroll.bind(this);
    this.unlockScroll = this.unlockScroll.bind(this);
  }

  /**
   * Lock scroll and hide body until ready
   */
  lockScroll() {
    if (this.isScrollLocked) return;
    
    document.documentElement.classList.add('no-scroll');
    document.body.style.visibility = 'hidden';
    this.isScrollLocked = true;
  }

  /**
   * Unlock scroll and show body
   */
  unlockScroll() {
    if (!this.isScrollLocked) return;
    
    document.documentElement.classList.remove('no-scroll');
    document.body.style.visibility = 'visible';
    this.isScrollLocked = false;
  }

  /**
   * Check if WebGL is available
   */
  hasWebGL() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && 
                (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if motion is preferred
   */
  wantsMotion() {
    if (localStorage.getItem('bl:anim:force') === 'true') return true;
    if (localStorage.getItem('bl:anim:force') === 'false') return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * Get the best available animation mode
   */
  getAnimationMode() {
    if (this.wantsMotion() && this.hasWebGL()) return 'webgl';
    if (this.wantsMotion()) return 'lottie';
    return 'svg';
  }

  /**
   * Initialize a scene with progressive enhancement
   */
  async initScene(sceneId, sceneModule) {
    const mode = this.getAnimationMode();
    console.log(`[SceneManager] Initializing ${sceneId} in ${mode} mode`);
    
    try {
      if (mode === 'webgl' && sceneModule.initWebGL) {
        const controller = await sceneModule.initWebGL();
        this.sceneControllers.set(sceneId, controller);
        return controller;
      } else if (mode === 'lottie' && sceneModule.initLottie) {
        const controller = await sceneModule.initLottie();
        this.sceneControllers.set(sceneId, controller);
        return controller;
      } else if (sceneModule.initSVG) {
        const controller = await sceneModule.initSVG();
        this.sceneControllers.set(sceneId, controller);
        return controller;
      }
    } catch (error) {
      console.error(`[SceneManager] Failed to initialize ${sceneId}:`, error);
      // Fallback to SVG
      if (sceneModule.initSVG) {
        const controller = await sceneModule.initSVG();
        this.sceneControllers.set(sceneId, controller);
        return controller;
      }
    }
    
    return null;
  }

  /**
   * Route to a specific scene
   */
  async route(page) {
    console.log(`[SceneManager] Routing to page: ${page}`);
    
    // Hide current scene
    if (this.currentScene) {
      const currentEl = document.getElementById(this.currentScene);
      if (currentEl) {
        currentEl.style.display = 'none';
      }
    }
    
    // Show new scene
    const sceneId = this.getSceneId(page);
    const sceneEl = document.getElementById(sceneId);
    if (sceneEl) {
      sceneEl.style.display = 'block';
      this.currentScene = sceneId;
      
      // Initialize scene if not already done
      if (!this.sceneControllers.has(sceneId)) {
        const sceneModule = await this.loadSceneModule(page);
        if (sceneModule) {
          await this.initScene(sceneId, sceneModule);
        }
      }
    }
  }

  /**
   * Get scene ID from page name
   */
  getSceneId(page) {
    const sceneMap = {
      'landing': 'gate',
      'home': 'hall',
      'read': 'desk',
      'watch': 'cinema',
      'about': 'timeline',
      'contact': 'desk',
      'dashboard': 'personal-library',
      'auth': 'personal-library'
    };
    return sceneMap[page] || 'gate';
  }

  /**
   * Load scene module dynamically
   */
  async loadSceneModule(page) {
    const moduleMap = {
      'landing': '/js/door-gate.js',
      'home': '/js/library-hall.js',
      'read': '/js/read-page.js',
      'watch': '/js/cinema-scene.js',
      'about': '/js/about-scene.js',
      'contact': '/js/contact-scene.js',
      'dashboard': '/js/dashboard-scene.js',
      'auth': '/js/dashboard-scene.js'
    };
    
    const modulePath = moduleMap[page];
    if (!modulePath) return null;
    
    try {
      const module = await import(modulePath);
      return module;
    } catch (error) {
      console.error(`[SceneManager] Failed to load module ${modulePath}:`, error);
      return null;
    }
  }

  /**
   * Register ready callback
   */
  ready(callback) {
    if (this.isBooted) {
      callback();
    } else {
      this.readyCallbacks.push(callback);
    }
  }

  /**
   * Boot the scene manager
   */
  async boot() {
    console.log('[SceneManager] Booting...');
    
    // Lock scroll initially
    this.lockScroll();
    
    // Wait for CSS to load
    await this.waitForCSS();
    
    // Wait for required libraries
    await this.waitForLibraries();
    
    // Initialize landing scene
    const page = document.body.getAttribute('data-page') || 'landing';
    await this.route(page);
    
    // Unlock scroll and show body
    this.unlockScroll();
    
    // Mark as booted
    this.isBooted = true;
    
    // Call ready callbacks
    this.readyCallbacks.forEach(callback => callback());
    this.readyCallbacks = [];
    
    console.log('[SceneManager] Boot complete');
  }

  /**
   * Wait for CSS to load
   */
  waitForCSS() {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        resolve();
        return;
      }
      
      const checkCSS = () => {
        const themeCSS = document.querySelector('link[href*="theme.css"]');
        if (themeCSS && themeCSS.sheet) {
          resolve();
        } else {
          setTimeout(checkCSS, 10);
        }
      };
      
      checkCSS();
    });
  }

  /**
   * Wait for required libraries
   */
  waitForLibraries() {
    return new Promise((resolve) => {
      const checkLibraries = () => {
        if (window.THREE && window.gsap && window.lottie) {
          resolve();
        } else {
          setTimeout(checkLibraries, 50);
        }
      };
      
      checkLibraries();
    });
  }

  /**
   * Pause all animations
   */
  pauseAll() {
    if (window.gsap) {
      gsap.globalTimeline.pause();
    }
    if (window.lottie) {
      lottie.getRegisteredAnimations().forEach(anim => anim.pause());
    }
    this.sceneControllers.forEach(controller => {
      if (controller.pause) controller.pause();
    });
  }

  /**
   * Resume all animations
   */
  resumeAll() {
    if (window.gsap) {
      gsap.globalTimeline.resume();
    }
    if (window.lottie) {
      lottie.getRegisteredAnimations().forEach(anim => anim.play());
    }
    this.sceneControllers.forEach(controller => {
      if (controller.resume) controller.resume();
    });
  }
}

// Global instance
window.SceneManager = new SceneManager();

// Handle visibility change
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    window.SceneManager.pauseAll();
  } else {
    window.SceneManager.resumeAll();
  }
});

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.SceneManager.boot();
  });
} else {
  window.SceneManager.boot();
}

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SceneManager;
}
