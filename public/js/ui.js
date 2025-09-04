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
  // FLOATING NAVIGATION
  // =========================
  class FloatingNav {
    constructor() {
      this.fab = null;
      this.menu = null;
      this.isOpen = false;
      this.init();
    }

    init() {
      this.fab = document.querySelector('.nav-fab');
      this.menu = document.querySelector('.nav-menu');
      
      if (!this.fab || !this.menu) return;

      this.setupEventListeners();
      this.setupKeyboardNavigation();
    }

    setupEventListeners() {
      this.fab.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggle();
      });

      // Close menu when clicking outside
      document.addEventListener('click', (e) => {
        if (this.isOpen && !this.fab.contains(e.target) && !this.menu.contains(e.target)) {
          this.close();
        }
      });

      // Close menu on escape key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });
    }

    setupKeyboardNavigation() {
      const menuItems = this.menu.querySelectorAll('a, button');
      
      menuItems.forEach((item, index) => {
        item.addEventListener('keydown', (e) => {
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault();
              const nextIndex = (index + 1) % menuItems.length;
              menuItems[nextIndex].focus();
              break;
            case 'ArrowUp':
              e.preventDefault();
              const prevIndex = index === 0 ? menuItems.length - 1 : index - 1;
              menuItems[prevIndex].focus();
              break;
            case 'Home':
              e.preventDefault();
              menuItems[0].focus();
              break;
            case 'End':
              e.preventDefault();
              menuItems[menuItems.length - 1].focus();
              break;
          }
        });
      });
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    open() {
      this.isOpen = true;
      this.fab.setAttribute('aria-expanded', 'true');
      this.menu.classList.add('open');
      
      // Focus first menu item
      const firstItem = this.menu.querySelector('a, button');
      if (firstItem) {
        setTimeout(() => firstItem.focus(), 100);
      }

      // Animate with GSAP if available
      if (window.gsap) {
        gsap.fromTo(this.menu, 
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(1.7)" }
        );
      }
    }

    close() {
      this.isOpen = false;
      this.fab.setAttribute('aria-expanded', 'false');
      this.menu.classList.remove('open');
      
      // Return focus to FAB
      this.fab.focus();

      // Animate with GSAP if available
      if (window.gsap) {
        gsap.to(this.menu, {
          scale: 0,
          opacity: 0,
          duration: 0.2,
          ease: "back.in(1.7)"
        });
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

        // Alt + M for menu toggle
        if (e.altKey && e.key === 'm') {
          e.preventDefault();
          const fab = document.querySelector('.nav-fab');
          if (fab) {
            fab.click();
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
      this.floatingNav = new FloatingNav();
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
