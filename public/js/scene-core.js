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
      if (gl) {
        // Test basic WebGL functionality
        const testTexture = gl.createTexture();
        gl.deleteTexture(testTexture);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  },

  hasWebGL() {
    return this.webglSupported;
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
      if (page === 'landing') {
        this.initLandingPage();
        console.log('[BL] page landing ready');
      }
      if (page === 'home') {
        this.initHomePage();
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
      if (page === 'watch') {
        this.initWatchPage();
        console.log('[BL] page watch ready');
      }
      if (page === 'about') {
        this.initAboutPage();
        console.log('[BL] page about ready');
      }
      if (page === 'contact') {
        this.initContactPage();
        console.log('[BL] page contact ready');
      }
      if (page === 'dashboard') {
        this.initDashboardPage();
        console.log('[BL] page dashboard ready');
      }
      if (page === 'auth') {
        this.initAuthPage();
        console.log('[BL] page auth ready');
      }
    } catch (e) {
      console.error('[BL] page init error', e);
    }
  },

  async initLandingPage() {
    const mode = this.getHeroMode();
    console.log('[BL] boot page=%s build=%s mode=%s', 'landing', window.BL_BUILD_ID || '?', mode);
    
    // Self-check: verify door containers exist
    const door3d = document.getElementById('door3d');
    const doorLottie = document.getElementById('door-lottie');
    const doorFallback = document.getElementById('door-fallback');
    
    if (!door3d && !doorLottie && !doorFallback) {
      console.warn('[BL] door containers missing');
      return;
    }
    
    switch (mode) {
      case 'webgl':
        await this.initWebGLDoor();
        break;
      case 'lottie':
        this.initLottieDoor();
        break;
      case 'static':
        this.initStaticDoor();
        break;
    }
  },

  async initHomePage() {
    const mode = this.getHeroMode();
    console.log('[BL] boot page=%s build=%s mode=%s', 'home', window.BL_BUILD_ID || '?', mode);
    
    // Self-check: verify library containers exist
    const library3d = document.getElementById('library3d');
    const libraryLottie = document.getElementById('library-lottie');
    const libraryFallback = document.getElementById('library-fallback');
    
    if (!library3d && !libraryLottie && !libraryFallback) {
      console.warn('[BL] library containers missing');
      return;
    }
    
    switch (mode) {
      case 'webgl':
        await this.initWebGLLibrary();
        break;
      case 'lottie':
        this.initLottieLibrary();
        break;
      case 'static':
        this.initStaticLibrary();
        break;
    }
  },

  async initWatchPage() {
    const mode = this.getHeroMode();
    console.log('[BL] boot page=%s build=%s mode=%s', 'watch', window.BL_BUILD_ID || '?', mode);
    
    const cinema3d = document.getElementById('cinema3d');
    const cinemaLottie = document.getElementById('cinema-lottie');
    const cinemaFallback = document.getElementById('cinema-fallback');
    
    if (!cinema3d && !cinemaLottie && !cinemaFallback) {
      console.warn('[BL] cinema containers missing');
      return;
    }
    
    switch (mode) {
      case 'webgl':
        await this.initWebGLCinema();
        break;
      case 'lottie':
        this.initLottieCinema();
        break;
      case 'static':
        this.initStaticCinema();
        break;
    }
  },

  async initAboutPage() {
    const mode = this.getHeroMode();
    console.log('[BL] boot page=%s build=%s mode=%s', 'about', window.BL_BUILD_ID || '?', mode);
    
    const about3d = document.getElementById('about3d');
    const aboutLottie = document.getElementById('about-lottie');
    const aboutFallback = document.getElementById('about-fallback');
    
    if (!about3d && !aboutLottie && !aboutFallback) {
      console.warn('[BL] about containers missing');
      return;
    }
    
    switch (mode) {
      case 'webgl':
        await this.initWebGLAbout();
        break;
      case 'lottie':
        this.initLottieAbout();
        break;
      case 'static':
        this.initStaticAbout();
        break;
    }
  },

  async initContactPage() {
    const mode = this.getHeroMode();
    console.log('[BL] boot page=%s build=%s mode=%s', 'contact', window.BL_BUILD_ID || '?', mode);
    
    const contact3d = document.getElementById('contact3d');
    const contactLottie = document.getElementById('contact-lottie');
    const contactFallback = document.getElementById('contact-fallback');
    
    if (!contact3d && !contactLottie && !contactFallback) {
      console.warn('[BL] contact containers missing');
      return;
    }
    
    switch (mode) {
      case 'webgl':
        await this.initWebGLContact();
        break;
      case 'lottie':
        this.initLottieContact();
        break;
      case 'static':
        this.initStaticContact();
        break;
    }
  },

  async initDashboardPage() {
    const mode = this.getHeroMode();
    console.log('[BL] boot page=%s build=%s mode=%s', 'dashboard', window.BL_BUILD_ID || '?', mode);
    
    const dashboard3d = document.getElementById('dashboard3d');
    const dashboardLottie = document.getElementById('dashboard-lottie');
    const dashboardFallback = document.getElementById('dashboard-fallback');
    
    if (!dashboard3d && !dashboardLottie && !dashboardFallback) {
      console.warn('[BL] dashboard containers missing');
      return;
    }
    
    switch (mode) {
      case 'webgl':
        await this.initWebGLDashboard();
        break;
      case 'lottie':
        this.initLottieDashboard();
        break;
      case 'static':
        this.initStaticDashboard();
        break;
    }
  },

  async initAuthPage() {
    const mode = this.getHeroMode();
    console.log('[BL] boot page=%s build=%s mode=%s', 'auth', window.BL_BUILD_ID || '?', mode);
    
    // Auth pages use the same cozy library scene as dashboard
    const auth3d = document.getElementById('auth3d');
    const authLottie = document.getElementById('auth-lottie');
    const authFallback = document.getElementById('auth-fallback');
    
    if (!auth3d && !authLottie && !authFallback) {
      console.warn('[BL] auth containers missing');
      return;
    }
    
    switch (mode) {
      case 'webgl':
        await this.initWebGLAuth();
        break;
      case 'lottie':
        this.initLottieAuth();
        break;
      case 'static':
        this.initStaticAuth();
        break;
    }
  },

  getHeroMode() {
    if (this.wantsMotion() && this.hasWebGL()) {
      return 'webgl';
    } else if (this.wantsMotion()) {
      return 'lottie';
    } else {
      return 'static';
    }
  },

  // Door scene methods
  async initWebGLDoor() {
    try {
      const lottieEl = document.getElementById('door-lottie');
      const fallbackEl = document.getElementById('door-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const { initDoorHero } = await import('/js/door-hero.js?v=' + (window.BL_BUILD_ID || ''));
      const doorController = initDoorHero({ containerId: 'door3d' });
      
      if (doorController) {
        window.doorController = doorController;
        console.log('[BL] WebGL door initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL door failed, falling back to Lottie:', error);
      this.initLottieDoor();
    }
  },

  initLottieDoor() {
    try {
      const canvasEl = document.getElementById('door3d');
      const fallbackEl = document.getElementById('door-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const lottieEl = document.getElementById('door-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('door-lottie', '/animations/door-open.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie door initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie door failed, falling back to static:', error);
      this.initStaticDoor();
    }
  },

  initStaticDoor() {
    try {
      const canvasEl = document.getElementById('door3d');
      const lottieEl = document.getElementById('door-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      const fallbackEl = document.getElementById('door-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static door initialized');
      }
    } catch (error) {
      console.error('[BL] Static door failed:', error);
    }
  },

  // Library scene methods
  async initWebGLLibrary() {
    try {
      const lottieEl = document.getElementById('library-lottie');
      const fallbackEl = document.getElementById('library-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const { initLibraryScene } = await import('/js/library-scene.js?v=' + (window.BL_BUILD_ID || ''));
      const libraryController = initLibraryScene({ containerId: 'library3d' });
      
      if (libraryController) {
        window.libraryController = libraryController;
        console.log('[BL] WebGL library initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL library failed, falling back to Lottie:', error);
      this.initLottieLibrary();
    }
  },

  initLottieLibrary() {
    try {
      const canvasEl = document.getElementById('library3d');
      const fallbackEl = document.getElementById('library-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const lottieEl = document.getElementById('library-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('library-lottie', '/animations/library-hall.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie library initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie library failed, falling back to static:', error);
      this.initStaticLibrary();
    }
  },

  initStaticLibrary() {
    try {
      const canvasEl = document.getElementById('library3d');
      const lottieEl = document.getElementById('library-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      const fallbackEl = document.getElementById('library-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static library initialized');
      }
    } catch (error) {
      console.error('[BL] Static library failed:', error);
    }
  },

  // Cinema scene methods
  async initWebGLCinema() {
    try {
      const lottieEl = document.getElementById('cinema-lottie');
      const fallbackEl = document.getElementById('cinema-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const { initCinemaScene } = await import('/js/cinema-scene.js?v=' + (window.BL_BUILD_ID || ''));
      const cinemaController = initCinemaScene({ containerId: 'cinema3d' });
      
      if (cinemaController) {
        window.cinemaController = cinemaController;
        console.log('[BL] WebGL cinema initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL cinema failed, falling back to Lottie:', error);
      this.initLottieCinema();
    }
  },

  initLottieCinema() {
    try {
      const canvasEl = document.getElementById('cinema3d');
      const fallbackEl = document.getElementById('cinema-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const lottieEl = document.getElementById('cinema-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('cinema-lottie', '/animations/curtain.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie cinema initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie cinema failed, falling back to static:', error);
      this.initStaticCinema();
    }
  },

  initStaticCinema() {
    try {
      const canvasEl = document.getElementById('cinema3d');
      const lottieEl = document.getElementById('cinema-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      const fallbackEl = document.getElementById('cinema-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static cinema initialized');
      }
    } catch (error) {
      console.error('[BL] Static cinema failed:', error);
    }
  },

  // About scene methods
  async initWebGLAbout() {
    try {
      const lottieEl = document.getElementById('about-lottie');
      const fallbackEl = document.getElementById('about-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const { initAboutScene } = await import('/js/about-scene.js?v=' + (window.BL_BUILD_ID || ''));
      const aboutController = initAboutScene({ containerId: 'about3d' });
      
      if (aboutController) {
        window.aboutController = aboutController;
        console.log('[BL] WebGL about initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL about failed, falling back to Lottie:', error);
      this.initLottieAbout();
    }
  },

  initLottieAbout() {
    try {
      const canvasEl = document.getElementById('about3d');
      const fallbackEl = document.getElementById('about-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const lottieEl = document.getElementById('about-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('about-lottie', '/animations/candle.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie about initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie about failed, falling back to static:', error);
      this.initStaticAbout();
    }
  },

  initStaticAbout() {
    try {
      const canvasEl = document.getElementById('about3d');
      const lottieEl = document.getElementById('about-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      const fallbackEl = document.getElementById('about-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static about initialized');
      }
    } catch (error) {
      console.error('[BL] Static about failed:', error);
    }
  },

  // Contact scene methods
  async initWebGLContact() {
    try {
      const lottieEl = document.getElementById('contact-lottie');
      const fallbackEl = document.getElementById('contact-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const { initContactScene } = await import('/js/contact-scene.js?v=' + (window.BL_BUILD_ID || ''));
      const contactController = initContactScene({ containerId: 'contact3d' });
      
      if (contactController) {
        window.contactController = contactController;
        console.log('[BL] WebGL contact initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL contact failed, falling back to Lottie:', error);
      this.initLottieContact();
    }
  },

  initLottieContact() {
    try {
      const canvasEl = document.getElementById('contact3d');
      const fallbackEl = document.getElementById('contact-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const lottieEl = document.getElementById('contact-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('contact-lottie', '/animations/pen.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie contact initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie contact failed, falling back to static:', error);
      this.initStaticContact();
    }
  },

  initStaticContact() {
    try {
      const canvasEl = document.getElementById('contact3d');
      const lottieEl = document.getElementById('contact-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      const fallbackEl = document.getElementById('contact-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static contact initialized');
      }
    } catch (error) {
      console.error('[BL] Static contact failed:', error);
    }
  },

  // Dashboard scene methods
  async initWebGLDashboard() {
    try {
      const lottieEl = document.getElementById('dashboard-lottie');
      const fallbackEl = document.getElementById('dashboard-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const { initDashboardScene } = await import('/js/dashboard-scene.js?v=' + (window.BL_BUILD_ID || ''));
      const dashboardController = initDashboardScene({ containerId: 'dashboard3d' });
      
      if (dashboardController) {
        window.dashboardController = dashboardController;
        console.log('[BL] WebGL dashboard initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL dashboard failed, falling back to Lottie:', error);
      this.initLottieDashboard();
    }
  },

  initLottieDashboard() {
    try {
      const canvasEl = document.getElementById('dashboard3d');
      const fallbackEl = document.getElementById('dashboard-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const lottieEl = document.getElementById('dashboard-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('dashboard-lottie', '/animations/flame.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie dashboard initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie dashboard failed, falling back to static:', error);
      this.initStaticDashboard();
    }
  },

  initStaticDashboard() {
    try {
      const canvasEl = document.getElementById('dashboard3d');
      const lottieEl = document.getElementById('dashboard-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      const fallbackEl = document.getElementById('dashboard-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static dashboard initialized');
      }
    } catch (error) {
      console.error('[BL] Static dashboard failed:', error);
    }
  },

  // Auth scene methods (reuse dashboard scene)
  async initWebGLAuth() {
    try {
      const lottieEl = document.getElementById('auth-lottie');
      const fallbackEl = document.getElementById('auth-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const { initDashboardScene } = await import('/js/dashboard-scene.js?v=' + (window.BL_BUILD_ID || ''));
      const authController = initDashboardScene({ containerId: 'auth3d' });
      
      if (authController) {
        window.authController = authController;
        console.log('[BL] WebGL auth initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL auth failed, falling back to Lottie:', error);
      this.initLottieAuth();
    }
  },

  initLottieAuth() {
    try {
      const canvasEl = document.getElementById('auth3d');
      const fallbackEl = document.getElementById('auth-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      const lottieEl = document.getElementById('auth-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('auth-lottie', '/animations/flame.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie auth initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie auth failed, falling back to static:', error);
      this.initStaticAuth();
    }
  },

  initStaticAuth() {
    try {
      const canvasEl = document.getElementById('auth3d');
      const lottieEl = document.getElementById('auth-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      const fallbackEl = document.getElementById('auth-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static auth initialized');
      }
    } catch (error) {
      console.error('[BL] Static auth failed:', error);
    }
  },

  // Legacy hero methods (keep for compatibility)
  async initWebGLHero() {
    try {
      // Hide fallbacks
      const lottieEl = document.getElementById('hero-lottie');
      const fallbackEl = document.getElementById('hero-fallback');
      if (lottieEl) lottieEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      // Dynamically import and initialize WebGL hero
      const { initHomeHero } = await import('/js/home-hero.js?v=' + (window.BL_BUILD_ID || ''));
      const heroController = initHomeHero({ containerId: 'hero3d' });
      
      if (heroController) {
        window.heroController = heroController;
        console.log('[BL] WebGL hero initialized');
      }
    } catch (error) {
      console.warn('[BL] WebGL hero failed, falling back to Lottie:', error);
      this.initLottieHero();
    }
  },

  initLottieHero() {
    try {
      // Hide WebGL canvas and static fallback
      const canvasEl = document.getElementById('hero3d');
      const fallbackEl = document.getElementById('hero-fallback');
      if (canvasEl) canvasEl.hidden = true;
      if (fallbackEl) fallbackEl.hidden = true;

      // Show and initialize Lottie
      const lottieEl = document.getElementById('hero-lottie');
      if (lottieEl) {
        lottieEl.hidden = false;
        this.tryLottie('hero-lottie', '/animations/library-hero.json', {
          loop: true,
          autoplay: true
        });
        console.log('[BL] Lottie hero initialized');
      }
    } catch (error) {
      console.warn('[BL] Lottie hero failed, falling back to static:', error);
      this.initStaticHero();
    }
  },

  initStaticHero() {
    try {
      // Hide WebGL canvas and Lottie
      const canvasEl = document.getElementById('hero3d');
      const lottieEl = document.getElementById('hero-lottie');
      if (canvasEl) canvasEl.hidden = true;
      if (lottieEl) lottieEl.hidden = true;

      // Show static fallback
      const fallbackEl = document.getElementById('hero-fallback');
      if (fallbackEl) {
        fallbackEl.hidden = false;
        console.log('[BL] Static hero initialized');
      }
    } catch (error) {
      console.error('[BL] Static hero failed:', error);
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
    // Pause all WebGL render loops
    const controllers = [
      'doorController', 'libraryController', 'cinemaController', 
      'aboutController', 'contactController', 'dashboardController', 
      'authController', 'heroController'
    ];
    controllers.forEach(controllerName => {
      if (window[controllerName] && window[controllerName].pause) {
        window[controllerName].pause();
      }
    });
  },
  
  resumeAll() {
    // Resume animations when tab becomes visible
    if (window.gsap) {
      gsap.globalTimeline.resume();
    }
    if (window.lottie) {
      lottie.getRegisteredAnimations().forEach(anim => anim.play());
    }
    // Resume all WebGL render loops
    const controllers = [
      'doorController', 'libraryController', 'cinemaController', 
      'aboutController', 'contactController', 'dashboardController', 
      'authController', 'heroController'
    ];
    controllers.forEach(controllerName => {
      if (window[controllerName] && window[controllerName].resume) {
        window[controllerName].resume();
      }
    });
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