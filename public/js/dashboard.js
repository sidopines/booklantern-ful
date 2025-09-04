/**
 * public/js/dashboard.js - Dashboard Animation Module
 */

window.BLDesk = {
  init(anim) {
    console.log('[BL] dashboard init');
    
    // Load reading streak flame animation
    this.loadFlameAnimation(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
    
    // Setup counter animations
    this.setupCounterAnimations();
  },
  
  loadFlameAnimation(anim) {
    anim.tryLottie('readingStreak', '/public/animations/flame.json', {
      loop: true,
      autoplay: true
    });
  },
  
  setupGSAPAnimations() {
    if (!window.gsap || !window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Dashboard cards reveal
    gsap.utils.toArray('.dashboard-card').forEach((card, i) => {
      gsap.from(card, {
        opacity: 0,
        y: 50,
        duration: 0.8,
        delay: i * 0.1,
        scrollTrigger: {
          trigger: card,
          start: 'top 85%',
          toggleActions: 'play none none reverse'
        }
      });
    });
    
    // Reading streak meter animation
    const streakMeter = document.querySelector('.reading-streak');
    if (streakMeter) {
      gsap.from(streakMeter, {
        scale: 0.8,
        opacity: 0,
        duration: 1,
        ease: 'back.out(1.7)',
        scrollTrigger: {
          trigger: streakMeter,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        }
      });
    }
  },
  
  setupCounterAnimations() {
    const counters = document.querySelectorAll('.counter');
    
    counters.forEach(counter => {
      const target = parseInt(counter.textContent);
      const duration = 2;
      
      if (BL.anim.wantsMotion() && window.gsap) {
        gsap.from(counter, {
          textContent: 0,
          duration: duration,
          ease: 'power2.out',
          snap: { textContent: 1 },
          onUpdate: function() {
            counter.textContent = Math.ceil(this.targets()[0].textContent);
          },
          onComplete: () => {
            // Confetti burst on milestone
            if (target % 10 === 0) {
              this.createConfettiBurst(counter);
            }
          }
        });
      }
    });
  },
  
  createConfettiBurst(element) {
    if (!window.gsap) return;
    
    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981'];
    
    for (let i = 0; i < 20; i++) {
      const confetti = document.createElement('div');
      confetti.style.cssText = `
        position: absolute;
        width: 6px;
        height: 6px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        border-radius: 50%;
        pointer-events: none;
        z-index: 1000;
      `;
      
      const rect = element.getBoundingClientRect();
      confetti.style.left = rect.left + rect.width / 2 + 'px';
      confetti.style.top = rect.top + rect.height / 2 + 'px';
      
      document.body.appendChild(confetti);
      
      gsap.to(confetti, {
        x: (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 200,
        scale: 0,
        rotation: Math.random() * 360,
        duration: 1,
        ease: "power2.out",
        onComplete: () => confetti.remove()
      });
    }
  }
};
