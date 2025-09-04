/**
 * public/js/scene-core.js - Safe animation mounting and scene management
 * Handles Three.js, Lottie, and parallax scenes with graceful fallbacks
 */

(function() {
  'use strict';

  // =========================
  // SCENE MANAGER
  // =========================
  class SceneManager {
    constructor() {
      this.scenes = new Map();
      this.isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.observers = new Map();
      this.init();
    }

    init() {
      // Listen for reduced motion changes
      window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
        this.isReducedMotion = e.matches;
        this.updateAllScenes();
      });

      // Cleanup on page unload
      window.addEventListener('beforeunload', () => {
        this.destroyAll();
      });
    }

    // =========================
    // THREE.JS SCENE HELPERS
    // =========================
    async tryThreeScene(containerId, sceneBuilder) {
      if (this.isReducedMotion) {
        return this.createCSSFallback(containerId, '3D scene');
      }

      try {
        if (!window.THREE) {
          console.warn('Three.js not loaded, using CSS fallback');
          return this.createCSSFallback(containerId, '3D scene');
        }

        const container = document.getElementById(containerId);
        if (!container) {
          console.warn(`Container ${containerId} not found`);
          return null;
        }

        const scene = await sceneBuilder(container);
        this.scenes.set(containerId, { type: 'three', scene });
        return scene;
      } catch (error) {
        console.warn('Three.js scene failed:', error);
        return this.createCSSFallback(containerId, '3D scene');
      }
    }

    // =========================
    // LOTTIE ANIMATION HELPERS
    // =========================
    async tryLottie(containerId, animationPath, options = {}) {
      if (this.isReducedMotion && !options.allowReducedMotion) {
        return this.createStaticFallback(containerId, animationPath);
      }

      try {
        if (!window.lottie) {
          console.warn('Lottie not loaded, using static fallback');
          return this.createStaticFallback(containerId, animationPath);
        }

        const container = document.getElementById(containerId);
        if (!container) {
          console.warn(`Container ${containerId} not found`);
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

        this.scenes.set(containerId, { type: 'lottie', animation });
        return animation;
      } catch (error) {
        console.warn('Lottie animation failed:', error);
        return this.createStaticFallback(containerId, animationPath);
      }
    }

    // =========================
    // PARALLAX LAYERS
    // =========================
    addParallaxLayer(selector, options = {}) {
      if (this.isReducedMotion) return;

      const elements = document.querySelectorAll(selector);
      if (elements.length === 0) return;

      const speed = options.speed || 0.5;
      const direction = options.direction || 'vertical';

      const handleScroll = () => {
        const scrolled = window.pageYOffset;
        elements.forEach(el => {
          const rate = scrolled * speed;
          if (direction === 'vertical') {
            el.style.transform = `translateY(${rate}px)`;
          } else {
            el.style.transform = `translateX(${rate}px)`;
          }
        });
      };

      window.addEventListener('scroll', handleScroll, { passive: true });
      
      // Store cleanup function
      const cleanup = () => {
        window.removeEventListener('scroll', handleScroll);
        elements.forEach(el => {
          el.style.transform = '';
        });
      };

      this.scenes.set(`parallax-${selector}`, { type: 'parallax', cleanup });
    }

    // =========================
    // PARTICLE SYSTEMS
    // =========================
    createParticleSystem(containerId, options = {}) {
      if (this.isReducedMotion) return;

      const container = document.getElementById(containerId);
      if (!container) return;

      const particleCount = options.count || 20;
      const particles = [];

      // Create particles
      for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.cssText = `
          position: absolute;
          width: ${Math.random() * 4 + 1}px;
          height: ${Math.random() * 4 + 1}px;
          background: ${options.color || 'rgba(255, 255, 255, 0.3)'};
          border-radius: 50%;
          left: ${Math.random() * 100}%;
          top: ${Math.random() * 100}%;
          animation: float ${Math.random() * 10 + 10}s infinite linear;
          animation-delay: ${Math.random() * 5}s;
        `;
        container.appendChild(particle);
        particles.push(particle);
      }

      // Add CSS animation if not exists
      if (!document.getElementById('particle-animations')) {
        const style = document.createElement('style');
        style.id = 'particle-animations';
        style.textContent = `
          @keyframes float {
            0% { transform: translateY(0px) rotate(0deg); opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { transform: translateY(-100vh) rotate(360deg); opacity: 0; }
          }
        `;
        document.head.appendChild(style);
      }

      const cleanup = () => {
        particles.forEach(particle => particle.remove());
      };

      this.scenes.set(containerId, { type: 'particles', cleanup });
    }

    // =========================
    // SPOTLIGHT EFFECTS
    // =========================
    createSpotlight(containerId, options = {}) {
      if (this.isReducedMotion) return;

      const container = document.getElementById(containerId);
      if (!container) return;

      const spotlight = document.createElement('div');
      spotlight.className = 'spotlight';
      spotlight.style.cssText = `
        position: absolute;
        width: ${options.width || '300px'};
        height: ${options.height || '300px'};
        background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
        border-radius: 50%;
        pointer-events: none;
        z-index: 1;
        left: ${options.x || '50%'};
        top: ${options.y || '50%'};
        transform: translate(-50%, -50%);
        animation: spotlight-pulse 4s ease-in-out infinite;
      `;

      container.style.position = 'relative';
      container.appendChild(spotlight);

      // Add CSS animation if not exists
      if (!document.getElementById('spotlight-animations')) {
        const style = document.createElement('style');
        style.id = 'spotlight-animations';
        style.textContent = `
          @keyframes spotlight-pulse {
            0%, 100% { opacity: 0.3; transform: translate(-50%, -50%) scale(1); }
            50% { opacity: 0.6; transform: translate(-50%, -50%) scale(1.1); }
          }
        `;
        document.head.appendChild(style);
      }

      const cleanup = () => {
        spotlight.remove();
      };

      this.scenes.set(containerId, { type: 'spotlight', cleanup });
    }

    // =========================
    // FALLBACK CREATORS
    // =========================
    createCSSFallback(containerId, description) {
      const container = document.getElementById(containerId);
      if (!container) return null;

      container.innerHTML = `
        <div class="css-fallback" style="
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-2) 100%);
          border-radius: var(--radius-xl);
          color: white;
          text-align: center;
          padding: var(--space-lg);
        ">
          <div>
            <div style="font-size: 2rem; margin-bottom: var(--space-md);">✨</div>
            <div style="font-size: 0.9rem; opacity: 0.8;">${description}</div>
          </div>
        </div>
      `;

      return { type: 'css-fallback', container };
    }

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
        'page-flip': '📄'
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

    // =========================
    // SCENE MANAGEMENT
    // =========================
    updateAllScenes() {
      this.scenes.forEach((scene, id) => {
        if (this.isReducedMotion) {
          this.pauseScene(scene);
        } else {
          this.resumeScene(scene);
        }
      });
    }

    pauseScene(scene) {
      switch (scene.type) {
        case 'lottie':
          if (scene.animation) scene.animation.pause();
          break;
        case 'three':
          // Three.js scenes are paused by reducing animation speed
          break;
        case 'parallax':
          // Parallax is disabled in reduced motion
          break;
      }
    }

    resumeScene(scene) {
      switch (scene.type) {
        case 'lottie':
          if (scene.animation) scene.animation.play();
          break;
        case 'three':
          // Three.js scenes resume normal speed
          break;
      }
    }

    destroyScene(id) {
      const scene = this.scenes.get(id);
      if (!scene) return;

      switch (scene.type) {
        case 'lottie':
          if (scene.animation) scene.animation.destroy();
          break;
        case 'three':
          if (scene.scene && scene.scene.dispose) scene.scene.dispose();
          break;
        case 'parallax':
        case 'particles':
        case 'spotlight':
          if (scene.cleanup) scene.cleanup();
          break;
      }

      this.scenes.delete(id);
    }

    destroyAll() {
      this.scenes.forEach((scene, id) => {
        this.destroyScene(id);
      });
      this.scenes.clear();
    }

    // =========================
    // INTERSECTION OBSERVER
    // =========================
    observeElement(selector, callback, options = {}) {
      const elements = document.querySelectorAll(selector);
      if (elements.length === 0) return;

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            callback(entry.target);
          }
        });
      }, {
        threshold: 0.1,
        ...options
      });

      elements.forEach(el => observer.observe(el));
      this.observers.set(selector, observer);
    }

    disconnectObserver(selector) {
      const observer = this.observers.get(selector);
      if (observer) {
        observer.disconnect();
        this.observers.delete(selector);
      }
    }
  }

  // =========================
  // PAGE TRANSITION MANAGER
  // =========================
  class PageTransitionManager {
    constructor() {
      this.isTransitioning = false;
      this.isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.init();
    }

    init() {
      if (this.isReducedMotion) return;

      // Listen for navigation
      document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        if (link.target === '_blank') return;

        e.preventDefault();
        this.transitionTo(href);
      });
    }

    transitionTo(url) {
      if (this.isTransitioning) return;
      this.isTransitioning = true;

      // Create page turn overlay
      const overlay = document.createElement('div');
      overlay.className = 'page-turn-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: var(--gradient-bg);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      `;

      overlay.innerHTML = `
        <div style="
          font-size: 3rem;
          color: var(--primary);
          animation: page-flip 0.6s ease-in-out;
        ">📖</div>
      `;

      // Add CSS animation if not exists
      if (!document.getElementById('page-transition-animations')) {
        const style = document.createElement('style');
        style.id = 'page-transition-animations';
        style.textContent = `
          @keyframes page-flip {
            0% { transform: rotateY(0deg) scale(1); }
            50% { transform: rotateY(90deg) scale(1.2); }
            100% { transform: rotateY(0deg) scale(1); }
          }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(overlay);

      // Animate in
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
      });

      // Navigate after animation
      setTimeout(() => {
        window.location.href = url;
      }, 600);
    }
  }

  // =========================
  // INITIALIZATION
  // =========================
  const sceneManager = new SceneManager();
  const pageTransitionManager = new PageTransitionManager();

  // Expose globally
  window.SceneManager = sceneManager;
  window.PageTransitionManager = pageTransitionManager;

  // Helper functions
  window.tryThreeScene = (containerId, sceneBuilder) => sceneManager.tryThreeScene(containerId, sceneBuilder);
  window.tryLottie = (containerId, animationPath, options) => sceneManager.tryLottie(containerId, animationPath, options);
  window.addParallaxLayer = (selector, options) => sceneManager.addParallaxLayer(selector, options);
  window.createParticleSystem = (containerId, options) => sceneManager.createParticleSystem(containerId, options);
  window.createSpotlight = (containerId, options) => sceneManager.createSpotlight(containerId, options);

  console.log('🎬 Scene Core initialized');

})();
