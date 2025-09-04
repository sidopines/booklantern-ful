/**
 * public/js/about.js - About Page Animation Module
 */

window.BLAbout = {
  init(anim) {
    console.log('[BL] about init');
    
    // Load candle animations
    this.loadCandleAnimations(anim);
    
    // Setup GSAP animations
    anim.tryGSAP(() => {
      this.setupGSAPAnimations();
    });
  },
  
  loadCandleAnimations(anim) {
    const candles = document.querySelectorAll('.timeline-candle');
    
    candles.forEach((candle, i) => {
      const candleId = `candle-${i}`;
      candle.id = candleId;
      
      anim.tryLottie(candleId, '/public/animations/candle.json', {
        loop: true,
        autoplay: true
      });
    });
  },
  
  setupGSAPAnimations() {
    if (!window.gsap || !window.ScrollTrigger) return;
    
    // Register ScrollTrigger
    gsap.registerPlugin(ScrollTrigger);
    
    // Timeline candles reveal
    gsap.utils.toArray('.timeline-candle').forEach((candle, i) => {
      gsap.from(candle, {
        opacity: 0,
        scale: 0.5,
        duration: 0.8,
        delay: i * 0.2,
        scrollTrigger: {
          trigger: candle,
          start: 'top 80%',
          toggleActions: 'play none none reverse'
        }
      });
    });
    
    // Team cards hover effect
    gsap.utils.toArray('.team-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        gsap.to(card, {
          scale: 1.05,
          duration: 0.3,
          ease: 'power2.out'
        });
      });
      
      card.addEventListener('mouseleave', () => {
        gsap.to(card, {
          scale: 1,
          duration: 0.3,
          ease: 'power2.out'
        });
      });
    });
  }
};
