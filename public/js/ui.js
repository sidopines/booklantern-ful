/* UI bootstrap: carousels + "Listen" buttons using Web Speech API */
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    initCarousels();
    initListenButtons();
    stickFooterToBottom();
  });

  function initCarousels() {
    const prevs = document.querySelectorAll('.carousel .prev');
    const nexts = document.querySelectorAll('.carousel .next');

    function scrollTrack(id, dir) {
      const track = document.getElementById(id);
      if (!track) return;
      const card = track.querySelector('.card');
      const step = card ? card.getBoundingClientRect().width + 16 : 320;
      track.scrollBy({ left: dir * step, behavior: 'smooth' });
    }

    prevs.forEach(btn => {
      btn.addEventListener('click', () => scrollTrack(btn.dataset.target, -1));
    });
    nexts.forEach(btn => {
      btn.addEventListener('click', () => scrollTrack(btn.dataset.target, 1));
    });

    // Enable horizontal wheel/trackpad scroll
    document.querySelectorAll('.carousel-track').forEach(track => {
      track.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
        e.preventDefault();
        track.scrollLeft += e.deltaX;
      }, { passive: false });
    });
  }

  function initListenButtons() {
    const support = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const buttons = document.querySelectorAll('.listen-btn');

    buttons.forEach(btn => {
      if (!support) {
        btn.disabled = true;
        btn.title = 'Listening not supported in this browser';
        return;
      }
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-listen') || '';
        if (!text) return;
        // Stop any previous speech first
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        // A friendlier default voice/rate than the “scary” default
        u.rate = 0.95;
        u.pitch = 1.05;
        u.volume = 1;
        window.speechSynthesis.speak(u);
      });
    });
  }

  function stickFooterToBottom() {
    const footer = document.querySelector('footer.site-footer');
    const main = document.querySelector('main');
    if (!footer || !main) return;
    const setMinHeight = () => {
      const vh = window.innerHeight;
      const headerH = (document.querySelector('header')?.offsetHeight) || 0;
      const footerH = footer.offsetHeight;
      main.style.minHeight = Math.max(0, vh - headerH - footerH) + 'px';
    };
    setMinHeight();
    window.addEventListener('resize', setMinHeight);
  }
})();
