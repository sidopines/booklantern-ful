/* ui.js — carousel centering + Listen (TTS) toast */

/* center short carousels to avoid left-stacked look */
(function centerCarousels(){
  document.querySelectorAll('.carousel').forEach(sec=>{
    const track = sec.querySelector('.carousel-track');
    if (!track) return;
    const scrollable = track.scrollWidth > track.clientWidth + 8;
    if (!scrollable) track.classList.add('is-short');
  });
})();

/* Listen (TTS) */
(function listenInit(){
  const toastId = 'bl-listen-toast';
  function ensureToast(){
    let el = document.getElementById(toastId);
    if (el) return el;
    el = document.createElement('div');
    el.id = toastId;
    el.className = 'toast';
    el.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px">Listen preview</div>
      <div id="bl-listen-now" class="muted" style="margin-bottom:10px;max-width:360px"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary" id="blplay" type="button">Play</button>
        <button class="btn secondary" id="blpause" type="button">Pause</button>
        <button class="btn secondary" id="blstop" type="button">Stop</button>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('blplay').onclick=()=>speechSynthesis.resume();
    document.getElementById('blpause').onclick=()=>speechSynthesis.pause();
    document.getElementById('blstop').onclick=()=>speechSynthesis.cancel();
    return el;
  }

  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-bl-listen]');
    if (!btn) return;
    const text = btn.getAttribute('data-bl-listen') || btn.getAttribute('data-text') || '';
    if (!window.speechSynthesis) { alert('Speech not supported on this browser.'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text || 'No description available.');
    u.rate = 1; u.pitch = 1;
    speechSynthesis.speak(u);
    const el = ensureToast();
    document.getElementById('bl-listen-now').textContent = text.slice(0, 160);
    el.style.display='block';
  });
})();
