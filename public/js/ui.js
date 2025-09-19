/**
 * public/js/ui.js - Shared UI behaviors for BookLantern
 * Handles theme toggle, menu interactions, scroll reveals, and accessibility
 */

(function() {
  'use strict';

  // =========================
  // THEME MANAGEMENT
  // =========================
  class ThemeManager {
    constructor() {
      this.theme = this.getStoredTheme() || this.getSystemTheme();
      this.init();
    }

    getSystemTheme() {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    getStoredTheme() {
      try {
        return localStorage.getItem('booklantern-theme');
      } catch (e) {
        return null;
      }
    }

    setStoredTheme(theme) {
      try {
        localStorage.setItem('booklantern-theme', theme);
      } catch (e) {
        // Ignore storage errors
      }
    }

    applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      this.theme = theme;
      this.setStoredTheme(theme);
    }

    toggle() {
      const newTheme = this.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(newTheme);
      return newTheme;
    }

    init() {
      this.applyTheme(this.theme);
      
      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', (e) => {
        if (!this.getStoredTheme()) {
          this.applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  // =========================
  // SCROLL REVEAL
  // =========================
  class ScrollReveal {
    constructor() {
      this.elements = document.querySelectorAll('.reveal');
      this.threshold = 0.1;
      this.init();
    }

    init() {
      if (this.elements.length === 0) return;

      // Check for reduced motion preference
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) {
        // Show all elements immediately
        this.elements.forEach(el => el.classList.add('visible'));
        return;
      }

      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              this.observer.unobserve(entry.target);
            }
          });
        },
        { threshold: this.threshold }
      );

      this.elements.forEach(el => this.observer.observe(el));
    }

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
      }
    }
  }

  // =========================
  // CAROUSEL FUNCTIONALITY
  // =========================
  class CarouselManager {
    constructor() {
      this.carousels = new Map();
      this.init();
    }

    init() {
      const carouselElements = document.querySelectorAll('.carousel-track');
      carouselElements.forEach(track => {
        const carouselId = track.id;
        if (carouselId) {
          this.carousels.set(carouselId, new Carousel(track));
        }
      });

      // Set up control buttons
      const controls = document.querySelectorAll('.carousel-control');
      controls.forEach(control => {
        control.addEventListener('click', (e) => {
          const carouselName = control.dataset.carousel;
          const direction = control.dataset.direction;
          const carouselId = `${carouselName}-carousel`;
          
          const carousel = this.carousels.get(carouselId);
          if (carousel) {
            if (direction === 'next') {
              carousel.next();
            } else if (direction === 'prev') {
              carousel.prev();
            }
          }
        });
      });
    }
  }

  class Carousel {
    constructor(track) {
      this.track = track;
      this.items = track.querySelectorAll('.carousel-item');
      this.itemWidth = 184 + 16; // Item width + gap
      this.visibleItems = this.calculateVisibleItems();
      this.currentIndex = 0;
      this.maxIndex = Math.max(0, this.items.length - this.visibleItems);
      
      this.init();
    }

    calculateVisibleItems() {
      const containerWidth = this.track.parentElement.offsetWidth;
      return Math.floor(containerWidth / this.itemWidth);
    }

    init() {
      // Handle window resize
      window.addEventListener('resize', () => {
        this.visibleItems = this.calculateVisibleItems();
        this.maxIndex = Math.max(0, this.items.length - this.visibleItems);
        this.updatePosition();
      });

      // Touch/swipe support for mobile
      this.setupTouchEvents();
    }

    setupTouchEvents() {
      let startX = 0;
      let currentX = 0;
      let isDragging = false;

      this.track.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
      });

      this.track.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
      });

      this.track.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;

        const diffX = startX - currentX;
        const threshold = 50;

        if (Math.abs(diffX) > threshold) {
          if (diffX > 0) {
            this.next();
          } else {
            this.prev();
          }
        }
      });
    }

    next() {
      if (this.currentIndex < this.maxIndex) {
        this.currentIndex += Math.min(3, this.maxIndex - this.currentIndex);
        this.updatePosition();
      }
    }

    prev() {
      if (this.currentIndex > 0) {
        this.currentIndex -= Math.min(3, this.currentIndex);
        this.updatePosition();
      }
    }

    updatePosition() {
      const translateX = -this.currentIndex * this.itemWidth;
      this.track.style.transform = `translateX(${translateX}px)`;
      
      this.updateControls();
    }

    updateControls() {
      const carouselId = this.track.id;
      const carouselName = carouselId.replace('-carousel', '');
      
      const prevBtn = document.querySelector(`[data-carousel="${carouselName}"][data-direction="prev"]`);
      const nextBtn = document.querySelector(`[data-carousel="${carouselName}"][data-direction="next"]`);
      
      if (prevBtn) {
        prevBtn.disabled = this.currentIndex === 0;
      }
      
      if (nextBtn) {
        nextBtn.disabled = this.currentIndex >= this.maxIndex;
      }
    }
  }

  // =========================
  // SEARCH ENHANCEMENTS
  // =========================
  class SearchEnhancer {
    constructor() {
      this.searchInputs = document.querySelectorAll('input[type="text"][name="query"]');
      this.init();
    }

    init() {
      this.searchInputs.forEach(input => {
        this.enhanceSearchInput(input);
      });
    }

    enhanceSearchInput(input) {
      // Add search icon
      const wrapper = document.createElement('div');
      wrapper.className = 'search-wrapper';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);

      // Add focus effects
      input.addEventListener('focus', () => {
        wrapper.classList.add('focused');
      });

      input.addEventListener('blur', () => {
        wrapper.classList.remove('focused');
      });

      // Add search suggestions placeholder (can be enhanced later)
      input.addEventListener('input', (e) => {
        this.handleSearchInput(e.target);
      });
    }

    handleSearchInput(input) {
      const query = input.value.trim();
      
      // Add visual feedback for search state
      if (query.length > 0) {
        input.classList.add('has-query');
      } else {
        input.classList.remove('has-query');
      }
    }
  }

  // =========================
  // PERFORMANCE MONITORING
  // =========================
  class PerformanceMonitor {
    constructor() {
      this.init();
    }

    init() {
      // Monitor Core Web Vitals
      if ('web-vital' in window) {
        // This would be implemented with web-vitals library
        // For now, just basic performance monitoring
        this.monitorPageLoad();
      }
    }

    monitorPageLoad() {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const perfData = performance.getEntriesByType('navigation')[0];
          if (perfData) {
            console.log('Page load time:', perfData.loadEventEnd - perfData.loadEventStart, 'ms');
          }
        }, 0);
      });
    }
  }

  // =========================
  // ACCESSIBILITY ENHANCEMENTS
  // =========================
  class AccessibilityEnhancer {
    constructor() {
      this.init();
    }

    init() {
      this.setupFocusManagement();
      this.setupKeyboardShortcuts();
      this.setupScreenReaderSupport();
    }

    setupFocusManagement() {
      // Add focus rings for keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          document.body.classList.add('keyboard-navigation');
        }
      });

      document.addEventListener('mousedown', () => {
        document.body.classList.remove('keyboard-navigation');
      });
    }

    setupKeyboardShortcuts() {
      document.addEventListener('keydown', (e) => {
        // Alt + T for theme toggle
        if (e.altKey && e.key === 't') {
          e.preventDefault();
          window.booklanternUI.themeManager.toggle();
        }

        // Alt + S for search focus
        if (e.altKey && e.key === 's') {
          e.preventDefault();
          const searchInput = document.querySelector('input[type="text"][name="query"]');
          if (searchInput) {
            searchInput.focus();
          }
        }

        // Alt + M for mobile menu toggle
        if (e.altKey && e.key === 'm') {
          e.preventDefault();
          const mobileToggle = document.querySelector('.header-mobile-toggle');
          if (mobileToggle) {
            mobileToggle.click();
          }
        }
      });
    }

    setupScreenReaderSupport() {
      // Add live region for dynamic content updates
      const liveRegion = document.createElement('div');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.className = 'sr-only';
      liveRegion.id = 'live-region';
      document.body.appendChild(liveRegion);
    }

    announce(message) {
      const liveRegion = document.getElementById('live-region');
      if (liveRegion) {
        liveRegion.textContent = message;
        setTimeout(() => {
          liveRegion.textContent = '';
        }, 1000);
      }
    }
  }

  // =========================
  // INITIALIZATION
  // =========================
  class BookLanternUI {
    constructor() {
      this.themeManager = new ThemeManager();
      this.scrollReveal = new ScrollReveal();
      this.carouselManager = new CarouselManager();
      this.searchEnhancer = new SearchEnhancer();
      this.performanceMonitor = new PerformanceMonitor();
      this.accessibilityEnhancer = new AccessibilityEnhancer();
      
      this.init();
    }

    init() {
      // Add global CSS for keyboard navigation
      const style = document.createElement('style');
      style.textContent = `
        .keyboard-navigation *:focus {
          outline: 2px solid var(--primary) !important;
          outline-offset: 2px !important;
        }
        
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        
        .search-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }
        
        .search-wrapper.focused input {
          box-shadow: var(--shadow-neon);
        }
        
        .search-wrapper input.has-query {
          border-color: var(--primary);
        }
      `;
      document.head.appendChild(style);

      // Expose theme toggle globally
      window.toggleTheme = () => {
        const newTheme = this.themeManager.toggle();
        this.accessibilityEnhancer.announce(`Theme changed to ${newTheme} mode`);
      };

      // Animation toggle functionality
      window.toggleAnimations = () => {
        const current = localStorage.getItem('bl:anim:force');
        const newSetting = current === 'on' ? 'off' : 'on';
        localStorage.setItem('bl:anim:force', newSetting);
        
        // Update UI
        const animText = document.getElementById('anim-text');
        const animIcon = document.getElementById('anim-icon');
        
        if (animText) {
          animText.textContent = newSetting === 'on' ? 'Anim: On' : 'Anim: Off';
        }
        
        if (animIcon) {
          animIcon.textContent = newSetting === 'on' ? '🎬' : '⏸️';
        }
        
        // Notify scene manager if available
        if (window.sceneManager) {
          window.sceneManager.animEnabled = newSetting === 'on';
        }
        
        this.accessibilityEnhancer.announce(`Animations ${newSetting}`);
        console.log(`[ANIM] Animations ${newSetting}`);
      };

      // Expose UI instance globally for debugging
      window.booklanternUI = this;

      console.log('🎨 BookLantern UI initialized');
    }

    destroy() {
      this.scrollReveal.destroy();
    }
  }

  // =========================
  // STARTUP
  // =========================
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new BookLanternUI();
    });
  } else {
    new BookLanternUI();
  }

})();

