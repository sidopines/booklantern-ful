// public/js/tts.js
// Lightweight browser Text-to-Speech for the injected book content.
// Phase A: Web Speech API (client-side); sentence highlighting.

(function(){
  const synth = window.speechSynthesis;
  let playing = false;
  let spans = [];
  let idx = 0;
  let utter = null;

  function supportsTTS(){ return !!synth && 'SpeechSynthesisUtterance' in window; }

  function splitIntoSentenceSpans(container){
    // idempotent – if spans already present, reuse.
    if (container.querySelector('.tts-s')) {
      spans = Array.from(container.querySelectorAll('.tts-s'));
      return spans;
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue || '';
      if (text.trim().length < 3) continue;
      targets.push(node);
    }

    const sentenceRegex = /([^.!?]+[.!?]+)|([^.!?]+$)/g;
    targets.forEach(node => {
      const parent = node.parentNode;
      const frag = document.createDocumentFragment();
      const t = node.nodeValue;
      let m, last = 0;
      if (!t) return;
      while ((m = sentenceRegex.exec(t)) !== null) {
        const s = (m[0] || '').trim();
        if (!s) continue;
        const span = document.createElement('span');
        span.className = 'tts-s';
        span.textContent = s + ' ';
        frag.appendChild(span);
        spans.push(span);
      }
      parent.replaceChild(frag, node);
    });
    return spans;
  }

  function clearHighlight(){
    const cur = document.querySelector('.tts-current');
    if (cur) cur.classList.remove('tts-current');
  }
  function highlight(i){
    clearHighlight();
    const span = spans[i];
    if (!span) return;
    span.classList.add('tts-current');
    // ensure visible
    span.scrollIntoView({ block:'nearest', inline:'nearest' });
  }

  function speakCurrent(){
    if (!spans[idx]) { stop(); return; }
    const text = spans[idx].textContent || '';
    clearUtter();
    utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.onend = () => { idx++; if (playing) speakCurrent(); };
    utter.onerror = () => { idx++; if (playing) speakCurrent(); };
    highlight(idx);
    synth.speak(utter);
  }

  function clearUtter(){
    if (utter) { try { utter.onend = utter.onerror = null; } catch(_){} }
    utter = null;
  }

  function stop(){
    playing = false;
    try { synth.cancel(); } catch(_){}
    clearUtter();
    clearHighlight();
  }

  // Public API
  window.BL_TTS = {
    toggle(container){
      if (!supportsTTS()) { alert('Text-to-Speech is not supported on this browser.'); return false; }
      if (!playing) {
        spans = splitIntoSentenceSpans(container);
        if (!spans.length) { alert('No readable text found.'); return false; }
        playing = true;
        speakCurrent();
      } else {
        stop();
      }
      return playing;
    }
  };
})();
