// public/js/reader.js
// Loads Gutenberg HTML via API, injects into reader, and provides pagination controls + themes + font size.

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

  // Tiny sanitizer: remove scripts/styles/iframes and on* attrs.
  function sanitizeHtml(s){
    s = String(s || '');

    // strip script/style/iframe
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    // remove inline event handlers
    s = s.replace(/\son\w+="[^"]*"/gi, '');
    s = s.replace(/\son\w+='[^']*'/gi, '');
    return s;
  }

  function updatePagination(){
    // Using CSS columns means the "pages" equal content scroll width / viewport width of the content container.
    const box = readerEl.getBoundingClientRect();
    pageWidth = Math.floor(box.width); // approximate
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
    // reflow after size change
    queueMicrotask(updatePagination);
  }

  function restorePrefs(){
    const t = localStorage.getItem('bl_theme');
    if (t) setTheme(t);
    const f = parseInt(localStorage.getItem('bl_font_size') || '0', 10);
    if (f) document.documentElement.style.setProperty('--font-size', f + 'px');
  }

  // Listeners
  btnPrev.addEventListener('click', () => goPage(-1));
  btnNext.addEventListener('click', () => goPage(+1));
  readerEl.addEventListener('scroll', () => { window.requestAnimationFrame(updateProgress); });

  btnFontDec.addEventListener('click', () => setFontSize(-2));
  btnFontInc.addEventListener('click', () => setFontSize(+2));

  btnThemeL.addEventListener('click', () => setTheme('light'));
  btnThemeS.addEventListener('click', () => setTheme('sepia'));
  btnThemeD.addEventListener('click', () => setTheme('dark'));

  // Keyboard: ← / →, PgUp / PgDn, space
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { e.preventDefault(); goPage(+1); }
    if (k === 'ArrowLeft'  || k === 'PageUp'   || (k === ' ' &&  e.shiftKey)) { e.preventDefault(); goPage(-1); }
  });

  // TTS integration button hooks (impl in tts.js)
  btnListen.addEventListener('click', () => {
    if (window.BL_TTS && window.BL_TTS.toggle) {
      const playing = window.BL_TTS.toggle(contentEl);
      btnListen.setAttribute('aria-pressed', playing ? 'true' : 'false');
      btnListen.textContent = playing ? '⏸ Pause' : '🔊 Listen';
    }
  });

  // Resize
  window.addEventListener('resize', () => {
    // allow layout to settle, then recompute
    clearTimeout(window.__bl_resize);
    window.__bl_resize = setTimeout(updatePagination, 120);
  });

  // Boot
  (async function init(){
    restorePrefs();
    await loadHtml();
    // after content is injected:
    updatePagination();
    // Focus for keyboard nav:
    readerEl.focus();
  })();
})();
