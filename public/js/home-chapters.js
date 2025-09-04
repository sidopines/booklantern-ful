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
    
    // Create floating dust particles
    this.createDustParticles(chapter1);
    
    // Book cards orbiting shelves
    const bookCards = chapter1.querySelectorAll('.floating-book');
    bookCards.forEach((card, index) => {
      gsap.fromTo(card,
        {
          y: 100,
          z: -50,
          opacity: 0,
          rotationY: 45,
          scale: 0.8
        },
        {
          y: 0,
          z: 0,
          opacity: 1,
          rotationY: 0,
          scale: 1,
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
      
      // Continuous floating animation
      gsap.to(card, {
        y: "random(-20, 20)",
        rotation: "random(-5, 5)",
        duration: "random(3, 5)",
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: index * 0.3
      });
    });
    
    // Bookshelf strip animation
    const bookshelf = chapter1.querySelector('.bookshelf-strip');
    if (bookshelf) {
      gsap.fromTo(bookshelf,
        {
          scaleX: 0,
          opacity: 0
        },
        {
          scaleX: 1,
          opacity: 1,
          duration: 2,
          ease: "power2.out",
          scrollTrigger: {
            trigger: bookshelf,
            start: "top 80%",
            toggleActions: "play none none reverse"
          }
        }
      );
    }
  },
  
  createDustParticles(container) {
    // Create floating dust particles
    for (let i = 0; i < 15; i++) {
      const particle = document.createElement('div');
      particle.className = 'dust-particle';
      particle.style.cssText = `
        position: absolute;
        width: 3px;
        height: 3px;
        background: rgba(255, 255, 255, 0.4);
        border-radius: 50%;
        pointer-events: none;
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 100}%;
      `;
      container.appendChild(particle);
      
      gsap.to(particle, {
        y: "random(-100, 100)",
        x: "random(-50, 50)",
        rotation: "random(0, 360)",
        duration: "random(15, 25)",
        repeat: -1,
        yoyo: true,
        ease: "none",
        delay: Math.random() * 5
      });
    }
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
    
    // Large page flip animation
    const pageFlip = chapter2.querySelector('.page-flip-demo');
    if (pageFlip) {
      gsap.fromTo(pageFlip,
        {
          rotationY: 0,
          transformOrigin: "left center",
          scale: 1
        },
        {
          rotationY: 180,
          scale: 1.1,
          duration: 3,
          repeat: -1,
          yoyo: true,
          ease: "power2.inOut",
          scrollTrigger: {
            trigger: pageFlip,
            start: "top 60%",
            end: "bottom 40%",
            scrub: 1
          }
        }
      );
    }
    
    // Hovering book with 3D tilt and glow
    const hoverBook = chapter2.querySelector('.hover-book');
    if (hoverBook) {
      hoverBook.addEventListener('mouseenter', () => {
        gsap.to(hoverBook, {
          rotationY: 15,
          rotationX: 10,
          scale: 1.05,
          z: 20,
          boxShadow: "0 0 30px rgba(99, 102, 241, 0.4)",
          duration: 0.3,
          ease: "power2.out"
        });
      });
      
      hoverBook.addEventListener('mouseleave', () => {
        gsap.to(hoverBook, {
          rotationY: 0,
          rotationX: 0,
          scale: 1,
          z: 0,
          boxShadow: "0 0 20px rgba(99, 102, 241, 0.2)",
          duration: 0.3,
          ease: "power2.out"
        });
      });
    }
    
    // Reading lamp spotlight effect
    const spotlight = chapter2.querySelector('.reading-spotlight');
    if (spotlight) {
      gsap.fromTo(spotlight,
        {
          opacity: 0,
          scale: 0.8
        },
        {
          opacity: 1,
          scale: 1,
          duration: 2,
          ease: "power2.out",
          scrollTrigger: {
            trigger: spotlight,
            start: "top 80%",
            toggleActions: "play none none reverse"
          }
        }
      );
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
    
    // Create constellation if it doesn't exist
    this.createConstellation(chapter3);
    
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
            transformOrigin: "left center",
            opacity: 0
          },
          {
            scaleX: 1,
            opacity: 1,
            duration: 1.5,
            delay: index * 0.2,
            ease: "power2.out",
            scrollTrigger: {
              trigger: constellation,
              start: "top 80%",
              toggleActions: "play none none reverse"
            }
          }
        );
      });
      
      // Animate nodes appearing with glow
      nodes.forEach((node, index) => {
        gsap.fromTo(node,
          {
            scale: 0,
            opacity: 0,
            boxShadow: "0 0 0px rgba(99, 102, 241, 0)"
          },
          {
            scale: 1,
            opacity: 1,
            boxShadow: "0 0 20px rgba(99, 102, 241, 0.4)",
            duration: 0.8,
            delay: index * 0.15,
            ease: "back.out(1.7)",
            scrollTrigger: {
              trigger: constellation,
              start: "top 80%",
              toggleActions: "play none none reverse"
            }
          }
        );
        
        // Continuous pulsing glow
        gsap.to(node, {
          boxShadow: "0 0 30px rgba(99, 102, 241, 0.6)",
          duration: 2,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          delay: index * 0.1
        });
      });
    }
  },
  
  createConstellation(container) {
    // Create constellation if it doesn't exist
    let constellation = container.querySelector('.constellation');
    if (!constellation) {
      constellation = document.createElement('div');
      constellation.className = 'constellation';
      constellation.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 400px;
        height: 300px;
        pointer-events: none;
      `;
      container.appendChild(constellation);
      
      // Create constellation nodes
      const topics = ['History', 'Science', 'Philosophy', 'Literature', 'Art', 'Mathematics'];
      const positions = [
        { x: 50, y: 20 }, { x: 80, y: 40 }, { x: 20, y: 60 },
        { x: 70, y: 80 }, { x: 30, y: 30 }, { x: 60, y: 70 }
      ];
      
      topics.forEach((topic, index) => {
        const node = document.createElement('div');
        node.className = 'constellation-node';
        node.style.cssText = `
          position: absolute;
          left: ${positions[index].x}%;
          top: ${positions[index].y}%;
          transform: translate(-50%, -50%);
        `;
        constellation.appendChild(node);
      });
      
      // Create constellation lines
      const connections = [
        [0, 1], [1, 3], [2, 4], [3, 5], [0, 2], [1, 5]
      ];
      
      connections.forEach(([from, to], index) => {
        const line = document.createElement('div');
        line.className = 'constellation-line';
        const fromPos = positions[from];
        const toPos = positions[to];
        
        const length = Math.sqrt(
          Math.pow(toPos.x - fromPos.x, 2) + 
          Math.pow(toPos.y - fromPos.y, 2)
        );
        const angle = Math.atan2(toPos.y - fromPos.y, toPos.x - fromPos.x) * 180 / Math.PI;
        
        line.style.cssText = `
          position: absolute;
          left: ${fromPos.x}%;
          top: ${fromPos.y}%;
          width: ${length}%;
          transform: translate(-50%, -50%) rotate(${angle}deg);
          transform-origin: left center;
        `;
        constellation.appendChild(line);
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
