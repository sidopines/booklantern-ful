(() => {
  // ----- Carousel arrows -----
  const tracks = document.querySelectorAll('.shelf');
  tracks.forEach(shelf => {
    const track = shelf.querySelector('.shelf-track');
    const prev  = shelf.querySelector('.prev');
    const next  = shelf.querySelector('.next');
    if (!track || !prev || !next) return;

    const step = () => Math.ceil(track.clientWidth * 0.9);
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left:  step(), behavior: 'smooth' }));
  });

  // ----- Listen (Web Speech API) -----
  let speaking = false;
  let utterance = null;

  function speak(text){
    if (!('speechSynthesis' in window)) {
      alert('Listening is not supported on this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    utterance = new SpeechSynthesisUtterance(text);
    // Choose a neutral voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => /en[-_](US|GB)/i.test(v.lang) && v.name.toLowerCase().includes('female'))
                    || voices.find(v => /en[-_](US|GB)/i.test(v.lang));
    if (preferred) utterance.voice = preferred;
    utterance.rate = 1.02;
    utterance.pitch = 1.0;

    speaking = true;
    utterance.onend = () => { speaking = false; };
    window.speechSynthesis.speak(utterance);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-listen');
    if (!btn) return;
    e.preventDefault();

    const title  = btn.getAttribute('data-title') || 'Untitled';
    const author = btn.getAttribute('data-author') || '';
    const line   = author ? `${title}, by ${author}.` : `${title}.`;
    const preview = `Preview. ${line}`;
    if (speaking) {
      window.speechSynthesis.cancel();
      speaking = false;
    } else {
      speak(preview);
    }
  });

  // Ensure voices are loaded on some browsers
  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
  }
})();
