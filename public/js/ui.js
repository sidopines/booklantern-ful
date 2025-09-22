/* ui.js — Listen + carousel centering + tiny helpers */

/* center short carousels */
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
  function makeToast(text){
    let el = document.getElementById(toastId);
    if (!el){
      el = document.createElement('div');
      el.id = toastId;
      el.className = 'toast';
      el.innerHTML = `
        <div style="font-weight:700;margin-bottom:6px">Listen</div>
        <div id="bl-listen-now" class="muted" style="margin-bottom:10px"></div>
        <div style="display:flex;gap:8px">
          <button class="btn secondary" id="blplay">Play</button>
          <button class="btn secondary" id="blpause">Pause</button>
          <button class="btn secondary" id="blstop">Stop</button>
        </div>`;
      document.body.appendChild(el);
      document.getElementById('blplay').onclick=()=>speechSynthesis.resume();
      document.getElementById('blpause').onclick=()=>speechSynthesis.pause();
      document.getElementById('blstop').onclick=()=>speechSynthesis.cancel();
    }
    document.getElementById('bl-listen-now').textContent = text.slice(0,140);
    el.style.display='block';
  }

  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-bl-listen]');
    if (!btn) return;
    const text = btn.getAttribute('data-bl-listen') || btn.getAttribute('data-text') || '';
    if (!window.speechSynthesis) { alert('Speech not supported'); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text || 'No description available.');
    u.rate = 1; u.pitch = 1;
    speechSynthesis.speak(u);
    makeToast(text || 'No description available.');
  });
})();
