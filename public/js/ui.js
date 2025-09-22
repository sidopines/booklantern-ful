/* ===========================================================
   BookLantern UI — minimal JS for carousels + Listen preview
   =========================================================== */

/* Carousel arrow delegation (works for all carousels) */
(function(){
  function track(btn){
    const shell = btn.closest('.section');
    return shell ? shell.querySelector('.carousel-track') : null;
  }
  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-scroll]');
    if(!btn) return;
    const t = track(btn);
    if(!t) return;
    const dir = btn.getAttribute('data-scroll');
    const delta = (dir === 'prev' ? -420 : 420);
    t.scrollBy({ left: delta, behavior: 'smooth' });
  });
})();

/* Listen preview via Web Speech API with selectable voice/rate/pitch */
(function(){
  if (!('speechSynthesis' in window)) return;

  const synth = window.speechSynthesis;
  let utter=null, toast=null, voiceSel=null, rateSel=null, pitchSel=null;

  const state = {
    voice: localStorage.getItem('bl.voice') || '',
    rate: parseFloat(localStorage.getItem('bl.rate') || '1'),
    pitch: parseFloat(localStorage.getItem('bl.pitch') || '1')
  };

  function ensureToast(){
    if (toast) return toast;
    toast = document.createElement('div');
    toast.className='toast';
    toast.innerHTML = `
      <div style="font-weight:800;margin-bottom:6px">Listen preview</div>
      <div class="muted" id="bl-text" style="max-width:340px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <label class="muted">Voice</label>
        <select id="bl-voice" class="input" style="height:36px;flex:1 0 220px;background:var(--surface-2);border-radius:8px"></select>
        <label class="muted">Rate</label>
        <input id="bl-rate" type="range" min="0.7" max="1.3" step="0.05" value="${state.rate}" />
        <label class="muted">Pitch</label>
        <input id="bl-pitch" type="range" min="0.8" max="1.2" step="0.05" value="${state.pitch}" />
      </div>
      <div class="actions">
        <button class="btn secondary" id="bl-play" type="button">Play</button>
        <button class="btn ghost" id="bl-pause" type="button">Pause</button>
        <button class="btn ghost" id="bl-stop" type="button">Stop</button>
      </div>`;
    document.body.appendChild(toast);

    voiceSel = toast.querySelector('#bl-voice');
    rateSel  = toast.querySelector('#bl-rate');
    pitchSel = toast.querySelector('#bl-pitch');

    document.getElementById('bl-play').onclick=()=>{ if(!utter) return; if(synth.paused) synth.resume(); else if(!synth.speaking) synth.speak(utter); };
    document.getElementById('bl-pause').onclick=()=>{ if(synth.speaking && !synth.paused) synth.pause(); };
    document.getElementById('bl-stop').onclick=()=>{ synth.cancel(); toast.classList.remove('show'); };

    rateSel.addEventListener('input', ()=>{ state.rate=parseFloat(rateSel.value); localStorage.setItem('bl.rate', String(state.rate)); });
    pitchSel.addEventListener('input', ()=>{ state.pitch=parseFloat(pitchSel.value); localStorage.setItem('bl.pitch', String(state.pitch)); });

    return toast;
  }

  function loadVoices(){
    const list = synth.getVoices();
    voiceSel.innerHTML = '';
    list.forEach(v=>{
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSel.appendChild(opt);
    });
    // choose saved or nicer defaults
    const preferred = state.voice ||
      (list.find(v=>/en[-_]US/i.test(v.lang) && /Female|Samantha|Jenny|Sara|Google US English/i.test(v.name))?.name) ||
      (list.find(v=>/en[-_]GB/i.test(v.lang))?.name) ||
      (list[0]?.name || '');
    state.voice = preferred; localStorage.setItem('bl.voice', preferred);
    voiceSel.value = preferred;
    voiceSel.addEventListener('change', ()=>{
      state.voice = voiceSel.value;
      localStorage.setItem('bl.voice', state.voice);
    });
  }
  synth.onvoiceschanged = ()=>{ if (voiceSel) loadVoices(); };

  function buildUtter(text){
    const u = new SpeechSynthesisUtterance(text);
    const v = synth.getVoices().find(x=>x.name===state.voice);
    if (v) u.voice = v;
    u.rate = state.rate;
    u.pitch = state.pitch;
    return u;
  }

  document.addEventListener('click',(e)=>{
    const btn=e.target.closest('[data-bl-listen]'); if(!btn) return;
    const text = btn.getAttribute('data-bl-listen') || 'Preview not available.';
    synth.cancel();
    const t=ensureToast();
    document.getElementById('bl-text').textContent=text.slice(0,220);
    if (voiceSel && !voiceSel.options.length) loadVoices();
    utter = buildUtter(text);
    utter.onend=()=>toast && toast.classList.remove('show');
    utter.onerror=()=>toast && toast.classList.remove('show');
    toast.classList.add('show');
    synth.speak(utter);
  });
})();
