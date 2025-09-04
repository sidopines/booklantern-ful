/**
 * public/js/contact.js - Contact Page Animation Module
 */

window.BLContact = {
  init(anim) {
    console.log('[BL] contact init');
    
    // Load pen writing animation
    this.loadPenAnimation(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
    
    // Setup form interactions
    this.setupFormInteractions();
  },
  
  loadPenAnimation(anim) {
    anim.tryLottie('penLine', '/public/animations/pen-writing.json', {
      loop: true,
      autoplay: true
    });
  },
  
  setupGSAPAnimations() {
    if (!window.gsap || !window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Form reveal
    gsap.from('.contact-form', {
      opacity: 0,
      y: 50,
      duration: 1,
      scrollTrigger: {
        trigger: '.contact-form',
        start: 'top 80%',
        toggleActions: 'play none none reverse'
      }
    });
    
    // Pen line animation
    gsap.from('.pen-line', {
      opacity: 0,
      scaleX: 0,
      duration: 1.5,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: '.pen-line',
        start: 'top 80%',
        toggleActions: 'play none none reverse'
      }
    });
  },
  
  setupFormInteractions() {
    const inputs = document.querySelectorAll('.contact-form input, .contact-form textarea');
    
    inputs.forEach(input => {
      // Glowing focus effect
      input.addEventListener('focus', () => {
        if (!BL.anim.wantsMotion()) return;
        
        input.style.boxShadow = '0 0 20px rgba(108, 124, 255, 0.3)';
        input.style.borderColor = 'var(--primary)';
      });
      
      input.addEventListener('blur', () => {
        if (!BL.anim.wantsMotion()) return;
        
        input.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.1)';
        input.style.borderColor = 'var(--glass-border)';
      });
    });
  }
};
