/* ui.js — centering, subtle reveal, Listen controls */

/* Center carousels when short */
(function(){
  function markShortTracks(){
    document.querySelectorAll('.carousel-track').forEach(t=>{
      t.classList.remove('is-short');
      if (t.scrollWidth <= t.clientWidth + 1) t.classList.add('is-short');
    });
  }
  window.addEventListener('DOMContentLoaded', markShortTracks);
  window.addEventListener('resize', markShortTracks);
})();

/* Reveal-on-load (cards fade-in) */
(function(){
  const els = document.querySelectorAll('.card.hover');
  els.forEach((el,i)=>{
    el.style.opacity='0'; el.style.transform='translateY(6px)';
    setTimeout(()=>{ el.style.transition='opacity .35s ease, transform .35s ease';
      el.style.opacity='1'; el.style.transform='translateY(0)'; }, 40 + i*30);
  });
})();

/* Listen via toast */
(function(){
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  let utter=null, toast=null;

  function ensureToast(){
    if (toast) return toast;
    toast = document.createElement('div');
    toast.className='toast';
    toast.innerHTML = `
      <div style="font-weight:900;margin-bottom:6px">Listen preview</div>
      <div class="muted" id="bl-text" style="max-width:340px"></div>
      <div class="actions">
        <button class="btn secondary" id="bl-play" type="button">Play</button>
        <button class="btn ghost" id="bl-pause" type="button">Pause</button>
        <button class="btn ghost" id="bl-stop" type="button">Stop</button>
      </div>`;
    document.body.appendChild(toast);
    document.getElementById('bl-play').onclick=()=>{ if(!utter) return; if(synth.paused) synth.resume(); else if(!synth.speaking) synth.speak(utter); };
    document.getElementById('bl-pause').onclick=()=>{ if(synth.speaking && !synth.paused) synth.pause(); };
    document.getElementById('bl-stop').onclick=()=>{ synth.cancel(); toast.classList.remove('show'); };
    return toast;
  }

  function pickVoice(){ const v=synth.getVoices(); return v.find(x=>/en[-_]US/i.test(x.lang))||v[0]||null; }

  document.addEventListener('click',(e)=>{
    const btn=e.target.closest('[data-bl-listen]'); if(!btn) return;
    const text = btn.getAttribute('data-bl-listen') || 'Preview not available.';
    synth.cancel();
    utter = new SpeechSynthesisUtterance(text);
    const v=pickVoice(); if(v) utter.voice=v;
    utter.onend=()=>toast && toast.classList.remove('show');
    utter.onerror=()=>toast && toast.classList.remove('show');
    const t=ensureToast(); document.getElementById('bl-text').textContent=text.slice(0,200); t.classList.add('show');
    synth.speak(utter);
  });
})();
