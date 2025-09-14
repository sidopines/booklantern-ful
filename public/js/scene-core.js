// public/js/scene-core.js
class SceneManager {
  constructor() {
    this.webglSupported = this.detectWebGL();
    this.animEnabled = this.getAnimSetting();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.gateInstance = null;
    this.hallInstance = null;
    this.isTransitioning = false;
  }

  detectWebGL() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return false;
      
      // Test texture creation
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 255]));
      
      const isValid = gl.getError() === gl.NO_ERROR;
      gl.deleteTexture(texture);
      canvas.remove();
      
      return isValid;
    } catch (e) {
      return false;
    }
  }

  getAnimSetting() {
    // Check for user override first
    const override = localStorage.getItem('bl:anim:force');
    if (override === 'on') return true;
    if (override === 'off') return false;
    
    // Respect prefers-reduced-motion
    if (this.reducedMotion) return false;
    
    // Default to on
    return true;
  }

  lockScroll() {
    document.body.classList.add('scrolling-locked');
  }

  unlockScroll() {
    document.body.classList.remove('scrolling-locked');
  }

  boot() {
    console.log('[GATE] booting...', {
      webgl: this.webglSupported,
      anim: this.animEnabled,
      reducedMotion: this.reducedMotion
    });

    this.lockScroll();
    
    const gateEl = document.getElementById('gate');
    if (gateEl) {
      this.mountGate(gateEl);
    } else {
      console.warn('[GATE] element not found');
    }

    // Listen for Gate:enter event
    window.addEventListener('Gate:enter', () => {
      this.handleGateEnter();
    });
  }

  mountGate(element) {
    // Simple CSS-only approach for production reliability
    const enterButton = element.querySelector('.gate__enter');
    if (enterButton) {
      enterButton.addEventListener('click', () => {
        this.handleEnterClick();
      });
      
      enterButton.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.handleEnterClick();
        }
      });
    }
    
    console.log('[GATE] mounted with mode: css');
  }
  
  handleEnterClick() {
    console.log('[GATE] enter');
    
    // Emit the Gate:enter event
    window.dispatchEvent(new CustomEvent('Gate:enter'));
  }

  mountHall(element) {
    if (!window.LibraryHall) {
      console.warn('[HALL] LibraryHall class not available');
      return;
    }

    try {
      this.hallInstance = new LibraryHall({
        webgl: this.webglSupported && this.animEnabled,
        reducedMotion: this.reducedMotion
      });
      this.hallInstance.mount(element);
      console.log('[HALL] mounted with mode:', this.hallInstance.mode);
    } catch (e) {
      console.error('[HALL] mount failed:', e);
    }
  }

  handleGateEnter() {
    if (this.isTransitioning) return;
    
    this.isTransitioning = true;
    console.log('[GATE] enter');

    // Hide gate, show hall, unlock scroll
    const gateEl = document.getElementById('gate');
    const hallEl = document.getElementById('hall');
    
    if (gateEl) gateEl.classList.add('hidden');
    if (hallEl) {
      hallEl.classList.remove('hidden');
      this.mountHall(hallEl);
    }
    
    this.unlockScroll();
    
    // Update page state for scene reporting
    document.body.setAttribute('data-page', 'hall');
    
    this.isTransitioning = false;
  }

  getCurrentSceneData() {
    const page = document.body.getAttribute('data-page') || 'unknown';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    
    let mode = 'css';
    let reason = null;
    
    if (reducedMotion) {
      reason = 'prefers-reduced-motion';
    }
    
    return {
      mode,
      page,
      reason,
      webglSupported: this.webglSupported,
      animEnabled: this.animEnabled,
      reducedMotion
    };
  }

  pauseAll() {
    if (this.gateInstance && typeof this.gateInstance.pause === 'function') {
      this.gateInstance.pause();
    }
    if (this.hallInstance && typeof this.hallInstance.pause === 'function') {
      this.hallInstance.pause();
    }
  }

  resumeAll() {
    if (this.gateInstance && typeof this.gateInstance.resume === 'function') {
      this.gateInstance.resume();
    }
    if (this.hallInstance && typeof this.hallInstance.resume === 'function') {
      this.hallInstance.resume();
    }
  }

  dispose() {
    if (this.gateInstance && typeof this.gateInstance.dispose === 'function') {
      this.gateInstance.dispose();
    }
    if (this.hallInstance && typeof this.hallInstance.dispose === 'function') {
      this.hallInstance.dispose();
    }
    this.unlockScroll();
  }
}

// Page visibility handling
document.addEventListener('visibilitychange', () => {
  if (window.sceneManager) {
    if (document.hidden) {
      window.sceneManager.pauseAll();
    } else {
      window.sceneManager.resumeAll();
    }
  }
});

// Export to global scope
window.SceneManager = SceneManager;