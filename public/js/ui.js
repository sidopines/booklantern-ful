// public/js/ui.js — UI behaviors + offline queue for Save/Notes
(function () {
  // Theme toggle
  const toggle = document.querySelector('#theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const root = document.documentElement;
      const cur = root.getAttribute('data-theme') || 'light';
      const next = cur === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('bl_theme', next); } catch {}
    });
  }

  // Simple helper
  const $ = (sel) => document.querySelector(sel);

  // =========================
  // Offline queue & background sync
  // =========================
  const QUEUE_KEY = 'blQueueV1';

  function loadQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }
  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
  }
  function enqueue(req) {
    const q = loadQueue();
    q.push({ ts: Date.now(), ...req });
    saveQueue(q);
    requestSync();
  }
  function requestSync() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        if (reg.sync && reg.sync.register) {
          reg.sync.register('bl-sync').catch(()=>{});
        }
      });
    }
  }
  async function flushQueue() {
    const q = loadQueue();
    if (!q.length) return;
    const still = [];
    for (const item of q) {
      try {
        const res = await fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify(item.body)
        });
        if (!res.ok) throw new Error('bad status');
      } catch {
        still.push(item);
      }
    }
    saveQueue(still);
  }

  // Trigger flush when regains online
  window.addEventListener('online', flushQueue);
  // Trigger flush when SW asks via background sync
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'BL_SYNC') flushQueue();
    });
  }

  // =========================
  // Reader page behaviors
  // =========================
  const isReader = document.body && document.body.dataset && document.body.dataset.page === 'reader';
  if (isReader) {
    const provider = document.body.dataset.provider;
    const bookId = document.body.dataset.bookId;
    const flow = $('#flow');
    const iframe = $('#doc');
    const titleEl = $('#r-title');

    // fetch book content
    (async () => {
      try {
        const r = await fetch(`/api/book?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(bookId)}`);
        const data = await r.json();
        if (data.title) titleEl.textContent = data.title;

        if (data.type === 'html') {
          iframe.hidden = true;
          flow.hidden = false;
          flow.innerHTML = data.content;
        } else if (data.type === 'text') {
          iframe.hidden = true;
          flow.hidden = false;
          flow.textContent = data.content;
        } else if (data.type === 'pdf' || data.type === 'epub') {
          flow.hidden = true;
          iframe.hidden = false;
          iframe.src = data.url;
        } else {
          iframe.hidden = true;
          flow.hidden = false;
          flow.innerHTML = `<p>Couldn’t load this book yet.</p>`;
        }
      } catch (e) {
        iframe.hidden = true;
        flow.hidden = false;
        flow.innerHTML = `<p>Failed to load book.</p>`;
      }
    })();

    // Listen (very basic TTS using SpeechSynthesis)
    const btnListen = $('#btn-listen');
    const rate = $('#rate');
    let speaking = false;
    function readTextFromFlow() {
      return flow && !flow.hidden ? (flow.innerText || '').slice(0, 10000) : '';
    }
    if (btnListen) {
      btnListen.addEventListener('click', () => {
        if (!speaking) {
          const text = readTextFromFlow();
          if (!text) return;
          const u = new SpeechSynthesisUtterance(text);
          u.rate = parseFloat(rate.value || '1');
          speechSynthesis.speak(u);
          speaking = true;
          btnListen.setAttribute('aria-pressed','true');
          u.onend = () => { speaking = false; btnListen.setAttribute('aria-pressed','false'); };
        } else {
          speechSynthesis.cancel();
          speaking = false;
          btnListen.setAttribute('aria-pressed','false');
        }
      });
      if (rate) rate.addEventListener('input', () => {
        if (speaking) { speechSynthesis.cancel(); speaking = false; btnListen.setAttribute('aria-pressed','false'); }
      });
    }

    // Save (library)
    const btnSaved = $('#btn-saved');
    if (btnSaved) {
      btnSaved.addEventListener('click', async () => {
        const payload = {
          provider, id: bookId,
          title: titleEl.textContent || '',
          author: '', cover: ''
        };
        try {
          const r = await fetch('/api/save', {
            method: 'POST', headers: { 'Content-Type':'application/json' },
            body: JSON.stringify(payload)
          });
          if (!r.ok) throw new Error('net');
          btnSaved.setAttribute('aria-pressed','true');
        } catch {
          // offline -> enqueue
          enqueue({ url:'/api/save', body: payload });
          btnSaved.setAttribute('aria-pressed','true');
        }
      });
    }

    // Notes
    const notesBtn = $('#btn-notes');
    const notesPanel = $('#notes');
    const notesClose = $('#btn-notes-close');
    const notesSave = $('#btn-notes-save');
    const notesText = $('#notes-text');
    const notesStatus = $('#notes-status');

    if (notesBtn && notesPanel) {
      notesBtn.addEventListener('click', async () => {
        notesPanel.classList.add('active');
        notesStatus.textContent = 'Loading…';
        try {
          const r = await fetch(`/api/notes?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(bookId)}`);
          const j = await r.json();
          const items = (j.notes || []).map(n => `• ${new Date(n.created_at).toLocaleString()}: ${n.text}`).join('\n');
          notesText.value = items ? (notesText.value ? notesText.value + '\n' + items : items) : (notesText.value || '');
          notesStatus.textContent = items ? 'Loaded.' : 'No notes yet.';
        } catch {
          notesStatus.textContent = 'Offline. Notes will sync when online.';
        }
      });
    }
    if (notesClose) notesClose.addEventListener('click', () => notesPanel.classList.remove('active'));
    if (notesSave && notesText) {
      notesSave.addEventListener('click', async () => {
        const text = notesText.value.trim();
        if (!text) return;
        const body = { provider, id: bookId, text, pos: null };
        try {
          const r = await fetch('/api/notes', {
            method: 'POST', headers: { 'Content-Type':'application/json' },
            body: JSON.stringify(body)
          });
          if (!r.ok) throw 0;
          notesStatus.textContent = 'Saved.';
        } catch {
          enqueue({ url:'/api/notes', body });
          notesStatus.textContent = 'Saved offline. Will sync.';
        }
      });
    }

    // Font size & theme buttons
    const dec = $('#btn-size-dec'), inc = $('#btn-size-inc'), theme = $('#btn-theme'), bookmark = $('#btn-bookmark');
    let fs = 18;
    function applyFS(){ if (flow) flow.style.setProperty('--fs', `${fs}px`); }
    if (dec) dec.addEventListener('click', ()=>{ fs=Math.max(14, fs-1); applyFS(); });
    if (inc) inc.addEventListener('click', ()=>{ fs=Math.min(28, fs+1); applyFS(); });
    if (theme) theme.addEventListener('click', ()=>{ const cur=document.documentElement.getAttribute('data-theme')||'light'; const next=cur==='light'?'dark':'light'; document.documentElement.setAttribute('data-theme',next); try{localStorage.setItem('bl_theme',next);}catch{} });
    if (bookmark) bookmark.addEventListener('click', ()=>{ try{ localStorage.setItem(`bm:${provider}:${bookId}`, Date.now().toString()); }catch{} });
  }
})();
