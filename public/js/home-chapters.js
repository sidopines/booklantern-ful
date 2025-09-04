/**
 * public/js/home-chapters.js - Scroll-driven Chapter Reveals
 * GSAP ScrollTrigger with parallax and masked transitions
 */

window.BLHomeChapters = {
  init(anim) {
    if (!anim.wantsMotion()) {
      this.createStaticChapters();
      return;
    }
    
    anim.tryGSAP(() => {
      this.setupScrollTrigger();
      this.createChapterAnimations();
    });
    
    console.log('[BL] Home chapters initialized');
  },
  
  setupScrollTrigger() {
    if (!window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Set up smooth scrolling
    gsap.to(window, {
      duration: 1,
      scrollTo: { y: 0 },
      ease: "power2.out"
    });
  },
  
  createChapterAnimations() {
    // Chapter 1: Discover
    this.createDiscoverChapter();
    
    // Chapter 2: Read
    this.createReadChapter();
    
    // Chapter 3: Learn
    this.createLearnChapter();
  },
  
  createDiscoverChapter() {
    const chapter1 = document.querySelector('.chapter-discover');
    if (!chapter1) return;
    
    // Pin the chapter
    ScrollTrigger.create({
      trigger: chapter1,
      start: "top top",
      end: "bottom top",
      pin: true,
      pinSpacing: false
    });
    
    // Flowing particles animation
    const particles = chapter1.querySelectorAll('.particle');
    particles.forEach((particle, index) => {
      gsap.fromTo(particle, 
        {
          x: -100,
          y: Math.random() * 100,
          opacity: 0,
          scale: 0
        },
        {
          x: window.innerWidth + 100,
          y: Math.random() * 100,
          opacity: 1,
          scale: 1,
          duration: 3 + Math.random() * 2,
          repeat: -1,
          delay: index * 0.1,
          ease: "none"
        }
      );
    });
    
    // Book cards floating in z-space
    const bookCards = chapter1.querySelectorAll('.floating-book');
    bookCards.forEach((card, index) => {
      gsap.fromTo(card,
        {
          y: 100,
          z: -50,
          opacity: 0,
          rotationY: 45
        },
        {
          y: 0,
          z: 0,
          opacity: 1,
          rotationY: 0,
          duration: 1.5,
          delay: index * 0.2,
          ease: "back.out(1.7)",
          scrollTrigger: {
            trigger: card,
            start: "top 80%",
            end: "bottom 20%",
            toggleActions: "play none none reverse"
          }
        }
      );
    });
  },
  
  createReadChapter() {
    const chapter2 = document.querySelector('.chapter-read');
    if (!chapter2) return;
    
    // Pin the chapter
    ScrollTrigger.create({
      trigger: chapter2,
      start: "top top",
      end: "bottom top",
      pin: true,
      pinSpacing: false
    });
    
    // Page-flip micro-animation
    const pageFlip = chapter2.querySelector('.page-flip-demo');
    if (pageFlip) {
      gsap.fromTo(pageFlip,
        {
          rotationY: 0,
          transformOrigin: "left center"
        },
        {
          rotationY: 180,
          duration: 2,
          repeat: -1,
          yoyo: true,
          ease: "power2.inOut"
        }
      );
    }
    
    // Hovering book with subtle refraction
    const hoverBook = chapter2.querySelector('.hover-book');
    if (hoverBook) {
      hoverBook.addEventListener('mouseenter', () => {
        gsap.to(hoverBook, {
          rotationY: 15,
          rotationX: 10,
          scale: 1.05,
          duration: 0.3,
          ease: "power2.out"
        });
      });
      
      hoverBook.addEventListener('mouseleave', () => {
        gsap.to(hoverBook, {
          rotationY: 0,
          rotationX: 0,
          scale: 1,
          duration: 0.3,
          ease: "power2.out"
        });
      });
    }
  },
  
  createLearnChapter() {
    const chapter3 = document.querySelector('.chapter-learn');
    if (!chapter3) return;
    
    // Pin the chapter
    ScrollTrigger.create({
      trigger: chapter3,
      start: "top top",
      end: "bottom top",
      pin: true,
      pinSpacing: false
    });
    
    // Constellation/lines connecting topics
    const constellation = chapter3.querySelector('.constellation');
    if (constellation) {
      const lines = constellation.querySelectorAll('.constellation-line');
      const nodes = constellation.querySelectorAll('.constellation-node');
      
      // Animate lines drawing
      lines.forEach((line, index) => {
        gsap.fromTo(line,
          {
            scaleX: 0,
            transformOrigin: "left center"
          },
          {
            scaleX: 1,
            duration: 1,
            delay: index * 0.1,
            ease: "power2.out",
            scrollTrigger: {
              trigger: constellation,
              start: "top 80%",
              toggleActions: "play none none reverse"
            }
          }
        );
      });
      
      // Animate nodes appearing
      nodes.forEach((node, index) => {
        gsap.fromTo(node,
          {
            scale: 0,
            opacity: 0
          },
          {
            scale: 1,
            opacity: 1,
            duration: 0.5,
            delay: index * 0.1,
            ease: "back.out(1.7)",
            scrollTrigger: {
              trigger: constellation,
              start: "top 80%",
              toggleActions: "play none none reverse"
            }
          }
        );
      });
    }
  },
  
  createStaticChapters() {
    // Create static fallbacks for reduced motion
    const chapters = document.querySelectorAll('.chapter-discover, .chapter-read, .chapter-learn');
    
    chapters.forEach(chapter => {
      chapter.style.position = 'relative';
      chapter.style.minHeight = '100vh';
      chapter.style.display = 'flex';
      chapter.style.alignItems = 'center';
      chapter.style.justifyContent = 'center';
      chapter.style.flexDirection = 'column';
      chapter.style.textAlign = 'center';
      chapter.style.padding = '2rem';
    });
  }
};
