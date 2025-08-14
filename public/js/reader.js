// public/js/reader.js
// Loads Gutenberg HTML via API, injects into reader, and provides:
// pagination, themes, font size, favorite toggle, chapters drawer, TTS hook, server MP3.

(function(){
  const boot = window.READER_BOOTSTRAP || {};
  const contentEl  = document.getElementById('readerContent');
  const readerEl   = document.getElementById('reader');
  const pageNowEl  = document.getElementById('pageNow');
  const pageTotEl  = document.getElementById('pageTotal');
  const fillEl     = document.getElementById('progressFill');

  const btnPrev = document.getElementById('prevPage');
  const btnNext = document.getElementById('nextPage');

  const btnFontDec = document.getElementById('fontDec');
  const btnFontInc = document.getElementById('fontInc');
  const btnThemeL  = document.getElementById('themeLight');
  const btnThemeS  = document.getElementById('themeSepia');
  const btnThemeD  = document.getElementById('themeDark');
  const btnListen  = document.getElementById('listenBtn');

  const btnFav     = document.getElementById('favBtn');

  const btnChapters     = document.getElementById('chaptersBtn');
  const panelChapters   = document.getElementById('chaptersPanel');
  const btnChaptersClose= document.getElementById('chaptersClose');
  const listChapters    = document.getElementById('chaptersList');

  const audioBtn = document.getElementById('audioBtn');

  let pageWidth = 0;
  let totalPages = 1;

  async function loadHtml(){
    const url = boot.fetchHtmlUrl;
    if (!url) return;
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('Failed to fetch book HTML');
    const data = await r.json();
    const html = (data && data.html) ? sanitizeHtml(data.html) : '<p>Could not load book text.</p>';
    contentEl.innerHTML = html;
  }

  function sanitizeHtml(s){
    s = String(s || '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    s = s.replace(/\son\w+="[^"]*"/gi, '');
    s = s.replace(/\son\w+='[^']*'/gi, '');
    return s;
  }

  function updatePagination(){
    const box = readerEl.getBoundingClientRect();
    pageWidth = Math.floor(box.width);
    const scrollW = contentEl.scrollWidth;
    totalPages = Math.max(1, Math.ceil(scrollW / pageWidth));
    pageTotEl.textContent = String(totalPages);
    updateProgress();
  }

  function currentPage(){
    const x = readerEl.scrollLeft || 0;
    return Math.min(totalPages, Math.max(1, Math.round(x / pageWidth) + 1));
  }

  function updateProgress(){
    const p = currentPage();
    pageNowEl.textContent = String(p);
    const ratio = totalPages > 1 ? ((p - 1) / (totalPages - 1)) : 0;
    fillEl.style.width = (ratio * 100) + '%';
  }

  function goPage(delta){
    const x = readerEl.scrollLeft || 0;
    readerEl.scrollTo({ left: x + (delta * pageWidth), behavior: 'smooth' });
  }

  function setTheme(name){
    readerEl.classList.remove('theme-light','theme-sepia','theme-dark');
    const cls = (name === 'sepia') ? 'theme-sepia' : (name === 'dark' ? 'theme-dark' : 'theme-light');
    readerEl.classList.add(cls);
    localStorage.setItem('bl_theme', name);
  }

  function setFontSize(delta){
    const root = document.documentElement;
    const cs = getComputedStyle(root).getPropertyValue('--font-size').trim() || '18px';
    const n = Math.max(14, Math.min(24, parseInt(cs, 10) + delta));
    root.style.setProperty('--font-size', n + 'px');
    localStorage.setItem('bl_font_size', String(n));
    queueMicrotask(updatePagination);
  }

  function restorePrefs(){
    const t = localStorage.getItem('bl_theme');
    if (t) setTheme(t);
    const f = parseInt(localStorage.getItem('bl_font_size') || '0', 10);
    if (f) document.documentElement.style.setProperty('--font-size', f + 'px');
  }

  // Favorite
  async function refreshFavorite(){
    try{
      const r = await fetch(boot.favorite.get, { credentials:'same-origin' });
      if (!r.ok) throw 0;
      const data = await r.json();
      const f = !!data.favorite;
      btnFav.textContent = f ? '♥ Favorited' : '♡ Favorite';
      btnFav.setAttribute('aria-pressed', f ? 'true' : 'false');
    }catch(_){}
  }
  async function toggleFavorite(){
    try{
      const r = await fetch(boot.favorite.toggle, { method:'POST', credentials:'same-origin' });
      if (!r.ok) throw 0;
      const data = await r.json();
      const f = !!data.favorite;
      btnFav.textContent = f ? '♥ Favorited' : '♡ Favorite';
      btnFav.setAttribute('aria-pressed', f ? 'true' : 'false');
    }catch(_){
      alert('Could not update favorite.');
    }
  }

  // Chapters
  function buildChapters(){
    listChapters.innerHTML = '';
    const heads = contentEl.querySelectorAll('h1, h2, h3');
    if (!heads.length) {
      listChapters.innerHTML = '<div style="color:#667085;font-size:.95rem;">No chapters found in this file.</div>';
      return;
    }
    heads.forEach(h => {
      if (!h.id) h.id = 'sec-' + Math.random().toString(36).slice(2,8);
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent.trim().replace(/\s+/g,' ').slice(0, 120);
      const lv = h.tagName === 'H1' ? 'ch-lv1' : (h.tagName === 'H2' ? 'ch-lv2' : 'ch-lv3');
      a.className = lv;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(h.id);
        if (!target) return;
        target.scrollIntoView({ behavior:'smooth', block:'start', inline:'nearest' });
        closeChapters();
      });
      listChapters.appendChild(a);
    });
  }
  function openChapters(){
    panelChapters.classList.add('open');
    btnChapters.setAttribute('aria-expanded', 'true');
  }
  function closeChapters(){
    panelChapters.classList.remove('open');
    btnChapters.setAttribute('aria-expanded', 'false');
  }
  btnChapters.addEventListener('click', () => {
    const open = panelChapters.classList.toggle('open');
    btnChapters.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  btnChaptersClose.addEventListener('click', closeChapters);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); goPage(+1); }
    if (k === 'ArrowLeft'  || k === 'PageUp'   || (k === ' ' &&  e.shiftKey)) { e.preventDefault(); goPage(-1); }
    if (k === 'Escape' && panelChapters.classList.contains('open')) { closeChapters(); }
  });

  // TTS (Phase A)
  btnListen.addEventListener('click', () => {
    if (window.BL_TTS && window.BL_TTS.toggle) {
      const playing = window.BL_TTS.toggle(contentEl);
      btnListen.setAttribute('aria-pressed', playing ? 'true' : 'false');
      btnListen.textContent = playing ? '⏸ Pause' : '🔊 Listen';
    } else {
      alert('TTS not supported in this browser.');
    }
  });

  // Server Audio (Phase B)
  function wireAudioButton(){
    if (!boot.ttsMp3Url) {
      audioBtn.setAttribute('disabled','disabled');
      return;
    }
    audioBtn.href = boot.ttsMp3Url;
    audioBtn.addEventListener('click', async (e) => {
      // Let the browser attempt to download. If the server returns 501 we’ll show an alert.
      try{
        const r = await fetch(boot.ttsMp3Url, { method:'HEAD' });
        if (r.status === 501) {
          e.preventDefault();
          alert('Server audio is not configured yet. Add TTS_API keys on the server to enable MP3.');
        }
      }catch(_){}
    });
  }

  // Resize
  window.addEventListener('resize', () => {
    clearTimeout(window.__bl_resize);
    window.__bl_resize = setTimeout(updatePagination, 120);
  });

  // Prev/Next
  btnPrev.addEventListener('click', () => goPage(-1));
  btnNext.addEventListener('click', () => goPage(+1));
  readerEl.addEventListener('scroll', () => { window.requestAnimationFrame(updateProgress); });

  // Font + Theme
  btnFontDec.addEventListener('click', () => setFontSize(-2));
  btnFontInc.addEventListener('click', () => setFontSize(+2));
  btnThemeL.addEventListener('click', () => setTheme('light'));
  btnThemeS.addEventListener('click', () => setTheme('sepia'));
  btnThemeD.addEventListener('click', () => setTheme('dark'));

  // Favorite
  btnFav.addEventListener('click', toggleFavorite);

  // Boot
  (async function init(){
    restorePrefs();
    await loadHtml();
    updatePagination();
    buildChapters();
    wireAudioButton();
    await refreshFavorite();
    readerEl.focus();
  })();
})();
