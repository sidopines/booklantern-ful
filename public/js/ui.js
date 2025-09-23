(() => {
  // -------- Carousel arrows --------
  document.querySelectorAll('.shelf').forEach(shelf => {
    const track = shelf.querySelector('.shelf-track');
    const prev  = shelf.querySelector('.prev');
    const next  = shelf.querySelector('.next');
    if (!track || !prev || !next) return;
    const step = () => Math.ceil(track.clientWidth * 0.9);
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left:  step(), behavior: 'smooth' }));
  });

  // -------- Cover fallback (hotlink/CSP resistant) --------
  // If an <img> fails, swap to images.weserv.nl proxy (https).
  window.blCoverFallback = (imgEl) => {
    if (!imgEl || imgEl.dataset.blProxied) return;
    try {
      const url = new URL(imgEl.src);
      const noProto = url.href.replace(/^https?:\/\//, '');
      imgEl.dataset.blProxied = '1';
      imgEl.src = `https://images.weserv.nl/?url=${encodeURIComponent(noProto)}&h=600&fit=inside`;
    } catch {
      // As a last resort, show initials block (remove the broken <img>)
      const wrap = imgEl.closest('.cover-wrap');
      if (wrap) {
        const title = (wrap.getAttribute('aria-label') || 'BL').replace(/^Read\s+/, '');
        const ph = document.createElement('div');
        ph.className = 'cover ph';
        ph.innerHTML = `<span class="ph-initials">${(title.trim().slice(0,2) || 'BL').toUpperCase()}</span>`;
        wrap.innerHTML = '';
        wrap.appendChild(ph);
      }
    }
  };

  // -------- Listen (SpeechSynthesis) --------
  let speaking = false;
  function speak(text){
    if (!('speechSynthesis' in window)) { alert('Listening is not supported on this browser.'); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /female/i.test(v.name))
                    || voices.find(v => /en[-_](US|GB)/i.test(v.lang))
                    || voices[0];
    if (preferred) u.voice = preferred;
    u.rate = 1.02; u.pitch = 1.0;
    speaking = true;
    u.onend = () => speaking = false;
    window.speechSynthesis.speak(u);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-listen');
    if (!btn) return;
    e.preventDefault();
    if (speaking) { window.speechSynthesis.cancel(); speaking = false; return; }
    const title  = btn.getAttribute('data-title')  || 'Untitled';
    const author = btn.getAttribute('data-author') || '';
    speak(`Preview. ${title}${author ? ', by ' + author : ''}.`);
  });

  // -------- Ensure whole card click works gracefully --------
  // If some cards still render bad hrefs, fix them to /read?q=Title Author.
  document.querySelectorAll('.book-card').forEach(card => {
    const title  = (card.querySelector('.title')?.textContent || '').trim();
    const author = (card.querySelector('.author')?.textContent || '').trim();
    const fallback = `/read?q=${encodeURIComponent([title, author].filter(Boolean).join(' '))}`;

    card.querySelectorAll('a[href="#"], a[href=""]').forEach(a => { a.setAttribute('href', fallback); });
    // make entire cover clickable via anchor already present; no JS needed
  });

  // iOS sometimes needs this to populate voices list on first load
  if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => {};
})();
