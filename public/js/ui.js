/* Carousel controls */
(function () {
  function setupCarousels() {
    document.querySelectorAll('.carousel').forEach((c) => {
      const track = c.querySelector('.carousel-track');
      const prev = c.querySelector('.carousel-btn.prev');
      const next = c.querySelector('.carousel-btn.next');
      if (!track || !prev || !next) return;

      const step = () => Math.min(track.clientWidth * 0.9, 600);

      prev.addEventListener('click', () => {
        track.scrollBy({ left: -step(), behavior: 'smooth' });
      });
      next.addEventListener('click', () => {
        track.scrollBy({ left: step(), behavior: 'smooth' });
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupCarousels);
  } else setupCarousels();
})();

/* Listen preview via Web Speech API */
(function () {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  let utter;

  function say(text) {
    if (!synth) return;
    if (synth.speaking) synth.cancel();
    utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    // prefer a friendly voice if available
    const voices = synth.getVoices();
    const prefer = voices.find(v => /en[-_](US|GB)/i.test(v.lang) && /female|Samantha|Google UK English Female/i.test(v.name));
    if (prefer) utter.voice = prefer;
    synth.speak(utter);
  }

  function handle(e) {
    const btn = e.target.closest('.listen-btn');
    if (!btn) return;
    const title = btn.getAttribute('data-title') || 'this book';
    const author = btn.getAttribute('data-author') || '';
    const text = author ? `Preview: ${title}, by ${author}.` : `Preview: ${title}.`;
    say(text);
  }

  document.addEventListener('click', handle);
  if (synth) {
    // Some browsers need user gesture before voices load
    window.addEventListener('load', () => synth.getVoices());
  }
})();
