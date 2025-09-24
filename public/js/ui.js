// ui.js — carousels + listen + cover fallback

(function () {
  // Carousel buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.carousel-btn');
    if (!btn) return;
    const sel = btn.getAttribute('data-target');
    const track = sel ? document.querySelector(sel) : null;
    if (!track) return;
    const step = Math.ceil(track.clientWidth * 0.9);
    const dir = btn.classList.contains('prev') ? -1 : 1;
    track.scrollBy({ left: step * dir, behavior: 'smooth' });
  });

  // Listen (Speech Synthesis)
  let speaking = false;
  function speak(text) {
    if (!('speechSynthesis' in window)) { alert('Listening not supported on this browser.'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const pick =
      voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /female/i.test(v.name)) ||
      voices.find(v => /en[-_](US|GB)/i.test(v.lang)) ||
      voices[0];
    if (pick) u.voice = pick;
    u.rate = 1.05; u.pitch = 1.0;
    speaking = true;
    u.onend = () => { speaking = false; };
    window.speechSynthesis.speak(u);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-listen');
    if (!btn) return;
    e.preventDefault();
    if (speaking) { window.speechSynthesis.cancel(); speaking = false; return; }
    const title = btn.getAttribute('data-title') || 'Untitled';
    const author = btn.getAttribute('data-author') || '';
    speak(`Preview. ${title}${author ? ', by ' + author : ''}.`);
  });

  // Cover fallback for broken images
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
      imgEl.style.display = 'none';
    }
  };

  // Ensure dead anchors fall back to read search
  document.querySelectorAll('.book-card').forEach(card => {
    const t = (card.querySelector('.title')?.textContent || '').trim();
    const a = (card.querySelector('.author')?.textContent || '').trim();
    const fallback = `/read?q=${encodeURIComponent([t, a].filter(Boolean).join(' '))}`;
    card.querySelectorAll('a[href="#"], a[href=""]').forEach(aEl => aEl.setAttribute('href', fallback));
  });

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = function () {};
  }
})();
