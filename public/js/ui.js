// ui.js — BookLantern frontend interactivity
// Supports BOTH carousel markup styles we’ve used:
//  A) bookCarousel.ejs with .shelf / .shelf-track / .prev .next
//  B) bookCarousel.ejs (latest) with .carousel-btn[data-target] + #trackId

(function () {
  // -----------------------------
  // Carousel: style A (.shelf ...)
  // -----------------------------
  document.querySelectorAll('.shelf').forEach(shelf => {
    const track = shelf.querySelector('.shelf-track');
    const prev = shelf.querySelector('.prev');
    const next = shelf.querySelector('.next');
    if (!track || !prev || !next) return;

    const step = () => Math.ceil(track.clientWidth * 0.9);
    prev.addEventListener('click', () => {
      track.scrollBy({ left: -step(), behavior: 'smooth' });
    });
    next.addEventListener('click', () => {
      track.scrollBy({ left: step(), behavior: 'smooth' });
    });
  });

  // -------------------------------------------
  // Carousel: style B (.carousel-btn[data-target])
  // -------------------------------------------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.carousel-btn');
    if (!btn) return;

    const sel = btn.getAttribute('data-target');
    const track = sel ? document.querySelector(sel) : null;
    if (!track) return;

    const amount = Math.ceil(track.clientWidth * 0.9);
    const dir = btn.classList.contains('prev') ? -1 : 1;
    track.scrollBy({ left: amount * dir, behavior: 'smooth' });
  });

  // --------------------------------
  // Listen (Web Speech Synthesis API)
  // --------------------------------
  let speaking = false;
  function speak(text) {
    if (!('speechSynthesis' in window)) {
      alert('Listening is not supported on this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    // Pick a neutral English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /female/i.test(v.name)) ||
      voices.find(v => /en[-_](US|GB)/i.test(v.lang)) ||
      voices[0];
    if (preferred) u.voice = preferred;
    u.rate = 1.04;
    u.pitch = 1.0;
    speaking = true;
    u.onend = () => { speaking = false; };
    window.speechSynthesis.speak(u);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-listen');
    if (!btn) return;

    e.preventDefault();
    if (speaking) {
      window.speechSynthesis.cancel();
      speaking = false;
      return;
    }
    const title = btn.getAttribute('data-title') || 'Untitled';
    const author = btn.getAttribute('data-author') || '';
    const preview = `Preview. ${title}${author ? ', by ' + author : ''}.`;
    speak(preview);
  });

  // ----------------------------------------
  // Cover fallback (onerror handler support)
  // ----------------------------------------
  // If an <img> fails, replace with a styled placeholder using title initials.
  window.blCoverFallback = function (imgEl) {
    try {
      const wrap = imgEl.closest('.cover-wrap');
      const label = (wrap?.getAttribute('aria-label') || '').replace(/^Read\s+/, '').trim();
      const initials = (label || 'BL').slice(0, 2).toUpperCase();

      const ph = document.createElement('div');
      ph.className = 'cover ph';
      ph.innerHTML = `<span class="ph-initials">${initials}</span>`;

      wrap.innerHTML = '';
      wrap.appendChild(ph);
    } catch {
      // last resort: just hide broken image
      imgEl.style.display = 'none';
    }
  };

  // iOS sometimes needs a voiceschanged poke
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = function () {};
  }

  // ---------------------------------------------
  // Safety: ensure any empty hrefs point to /read
  // ---------------------------------------------
  document.querySelectorAll('.book-card').forEach(card => {
    const t = (card.querySelector('.title')?.textContent || '').trim();
    const a = (card.querySelector('.author')?.textContent || '').trim();
    const fallback = `/read?q=${encodeURIComponent([t, a].filter(Boolean).join(' '))}`;
    card.querySelectorAll('a[href="#"], a[href=""]').forEach(aEl => aEl.setAttribute('href', fallback));
  });
})();
