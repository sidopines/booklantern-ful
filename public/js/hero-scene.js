/**
 * public/js/hero-scene.js - 3D Book Flip Animation for Homepage
 * Uses Three.js for WebGL book flip with CSS fallback
 */

(function() {
  'use strict';

  class HeroScene {
    constructor() {
      this.container = null;
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.book = null;
      this.animationId = null;
      this.isWebGLSupported = false;
      this.isReducedMotion = false;
      
      this.init();
    }

    init() {
      // Check for reduced motion preference
      this.isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      
      if (this.isReducedMotion) {
        this.createCSSFallback();
        return;
      }

      // Check for WebGL support
      this.isWebGLSupported = this.checkWebGLSupport();
      
      if (this.isWebGLSupported && window.THREE) {
        this.createThreeJSScene();
      } else {
        this.createCSSFallback();
      }
    }

    checkWebGLSupport() {
      try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && 
                 (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
      } catch (e) {
        return false;
      }
    }

    createThreeJSScene() {
      this.container = document.getElementById('hero-scene');
      if (!this.container) return;

      // Scene setup
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(75, this.container.offsetWidth / this.container.offsetHeight, 0.1, 1000);
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      
      this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
      this.renderer.setClearColor(0x000000, 0);
      this.container.appendChild(this.renderer.domElement);

      // Create book geometry
      this.createBook();
      
      // Position camera
      this.camera.position.z = 5;
      
      // Add lighting
      const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
      this.scene.add(ambientLight);
      
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 5, 5);
      this.scene.add(directionalLight);

      // Start animation
      this.animate();
      
      // Handle resize
      window.addEventListener('resize', () => this.onWindowResize());
    }

    createBook() {
      // Book cover
      const coverGeometry = new THREE.BoxGeometry(2, 3, 0.1);
      const coverMaterial = new THREE.MeshLambertMaterial({ 
        color: 0x6c7cff,
        transparent: true,
        opacity: 0.9
      });
      
      this.book = new THREE.Mesh(coverGeometry, coverMaterial);
      this.book.position.x = 0;
      this.book.position.y = 0;
      this.book.position.z = 0;
      
      this.scene.add(this.book);

      // Add pages
      const pagesGeometry = new THREE.BoxGeometry(1.8, 2.8, 0.8);
      const pagesMaterial = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
      const pages = new THREE.Mesh(pagesGeometry, pagesMaterial);
      pages.position.z = -0.05;
      this.book.add(pages);

      // Add title text (simplified)
      const titleGeometry = new THREE.PlaneGeometry(1.5, 0.3);
      const titleMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff,
        transparent: true,
        opacity: 0.8
      });
      const title = new THREE.Mesh(titleGeometry, titleMaterial);
      title.position.z = 0.06;
      title.position.y = 0.5;
      this.book.add(title);
    }

    animate() {
      if (!this.scene || !this.renderer || !this.camera) return;
      
      this.animationId = requestAnimationFrame(() => this.animate());
      
      // Rotate book
      if (this.book) {
        this.book.rotation.y += 0.01;
        this.book.rotation.x = Math.sin(Date.now() * 0.001) * 0.1;
      }
      
      this.renderer.render(this.scene, this.camera);
    }

    createCSSFallback() {
      this.container = document.getElementById('hero-scene');
      if (!this.container) return;

      this.container.innerHTML = `
        <div class="css-book">
          <div class="book-cover">
            <div class="book-title">BookLantern</div>
            <div class="book-subtitle">Discover • Read • Learn</div>
          </div>
          <div class="book-pages"></div>
          <div class="book-spine"></div>
        </div>
      `;

      // Add CSS animations
      const style = document.createElement('style');
      style.textContent = `
        .css-book {
          width: 200px;
          height: 300px;
          position: relative;
          transform-style: preserve-3d;
          animation: bookFloat 6s ease-in-out infinite;
        }
        
        .book-cover {
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-2) 100%);
          border-radius: 8px;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: white;
          text-align: center;
          box-shadow: var(--shadow-neon);
        }
        
        .book-title {
          font-size: 1.2rem;
          font-weight: var(--font-weight-bold);
          margin-bottom: 0.5rem;
        }
        
        .book-subtitle {
          font-size: 0.8rem;
          opacity: 0.9;
        }
        
        .book-pages {
          position: absolute;
          top: 4px;
          left: 4px;
          right: 4px;
          bottom: 4px;
          background: #f5f5f5;
          border-radius: 4px;
          z-index: -1;
        }
        
        .book-spine {
          position: absolute;
          left: -8px;
          top: 8px;
          bottom: 8px;
          width: 8px;
          background: linear-gradient(135deg, var(--primary) 0%, var(--primary-2) 100%);
          border-radius: 4px 0 0 4px;
          z-index: -2;
        }
        
        @keyframes bookFloat {
          0%, 100% { transform: rotateY(0deg) rotateX(5deg) translateY(0px); }
          50% { transform: rotateY(10deg) rotateX(-5deg) translateY(-10px); }
        }
        
        @media (prefers-reduced-motion: reduce) {
          .css-book {
            animation: none;
            transform: rotateY(5deg) rotateX(2deg);
          }
        }
      `;
      
      document.head.appendChild(style);
    }

    onWindowResize() {
      if (!this.camera || !this.renderer || !this.container) return;
      
      this.camera.aspect = this.container.offsetWidth / this.container.offsetHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.offsetWidth, this.container.offsetHeight);
    }

    destroy() {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
      }
      
      if (this.renderer) {
        this.renderer.dispose();
      }
      
      window.removeEventListener('resize', this.onWindowResize);
    }
  }

  // =========================
  // SCROLL REVEAL ENHANCEMENTS
  // =========================
  class ScrollRevealEnhancer {
    constructor() {
      this.init();
    }

    init() {
      // Wait for GSAP to load
      if (window.gsap) {
        this.setupGSAPReveals();
      } else {
        // Fallback to Intersection Observer
        this.setupObserverReveals();
      }
    }

    setupGSAPReveals() {
      // Create timeline for staggered reveals
      const tl = gsap.timeline();
      
      // Hero elements
      tl.from('.hero-title', {
        duration: 1,
        y: 50,
        opacity: 0,
        ease: "power3.out"
      })
      .from('.hero-subtitle', {
        duration: 0.8,
        y: 30,
        opacity: 0,
        ease: "power3.out"
      }, "-=0.5")
      .from('.hero-search', {
        duration: 0.8,
        y: 30,
        opacity: 0,
        ease: "power3.out"
      }, "-=0.3")
      .from('.hero-cta', {
        duration: 0.8,
        y: 30,
        opacity: 0,
        ease: "power3.out"
      }, "-=0.3");

      // Section reveals
      gsap.utils.toArray('.reveal-section').forEach((section, index) => {
        gsap.from(section, {
          duration: 0.8,
          y: 50,
          opacity: 0,
          ease: "power3.out",
          scrollTrigger: {
            trigger: section,
            start: "top 80%",
            end: "bottom 20%",
            toggleActions: "play none none reverse"
          }
        });
      });

      // Card reveals
      gsap.utils.toArray('.reveal-card').forEach((card, index) => {
        gsap.from(card, {
          duration: 0.6,
          y: 30,
          opacity: 0,
          ease: "power3.out",
          delay: index * 0.1,
          scrollTrigger: {
            trigger: card,
            start: "top 85%",
            toggleActions: "play none none reverse"
          }
        });
      });
    }

    setupObserverReveals() {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      }, { threshold: 0.1 });

      document.querySelectorAll('.reveal').forEach(el => {
        observer.observe(el);
      });
    }
  }

  // =========================
  // PARALLAX EFFECTS
  // =========================
  class ParallaxEffects {
    constructor() {
      this.init();
    }

    init() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
      }

      this.setupParallax();
    }

    setupParallax() {
      const parallaxElements = document.querySelectorAll('.parallax');
      
      window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const rate = scrolled * -0.5;
        
        parallaxElements.forEach(element => {
          element.style.transform = `translateY(${rate}px)`;
        });
      });
    }
  }

  // =========================
  // INITIALIZATION
  // =========================
  class HeroSceneManager {
    constructor() {
      this.heroScene = null;
      this.scrollReveal = null;
      this.parallax = null;
      
      this.init();
    }

    init() {
      // Initialize components
      this.heroScene = new HeroScene();
      this.scrollReveal = new ScrollRevealEnhancer();
      this.parallax = new ParallaxEffects();
      
      console.log('🎬 Hero Scene initialized');
    }

    destroy() {
      if (this.heroScene) {
        this.heroScene.destroy();
      }
    }
  }

  // =========================
  // STARTUP
  // =========================
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new HeroSceneManager();
    });
  } else {
    new HeroSceneManager();
  }

  // Expose for debugging
  window.HeroSceneManager = HeroSceneManager;

})();
