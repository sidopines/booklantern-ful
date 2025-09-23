(() => {
  // Carousel arrows
  document.querySelectorAll('.shelf').forEach(shelf => {
    const track = shelf.querySelector('.shelf-track');
    const prev  = shelf.querySelector('.prev');
    const next  = shelf.querySelector('.next');
    if (!track || !prev || !next) return;
    const step = () => Math.ceil(track.clientWidth * 0.9);
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left:  step(), behavior: 'smooth' }));
  });

  // Listen (SpeechSynthesis)
  let speaking = false;
  let current  = null;

  function speak(text){
    if (!('speechSynthesis' in window)) { alert('Listening is not supported on this browser.'); return; }
    window.speechSynthesis.cancel();
    current = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /female/i.test(v.name))
                    || voices.find(v => /en[-_](US|GB)/i.test(v.lang));
    if (preferred) current.voice = preferred;
    current.rate = 1.02; current.pitch = 1.0;
    speaking = true; current.onend = () => speaking = false;
    window.speechSynthesis.speak(current);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-listen');
    if (!btn) return;
    e.preventDefault();
    const title  = btn.getAttribute('data-title')  || 'Untitled';
    const author = btn.getAttribute('data-author') || '';
    const preview = `Preview. ${title}${author ? ', by ' + author : ''}.`;
    if (speaking) { window.speechSynthesis.cancel(); speaking = false; }
    else { speak(preview); }
  });

  if ('speechSynthesis' in window) window.speechSynthesis.onvoiceschanged = () => {};
})();
