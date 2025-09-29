// BookLantern theme controller (idempotent + accessible)
(function () {
  var KEY   = 'bl-theme';
  var root  = document.documentElement;
  var btn   = document.getElementById('themeToggle');
  var glyph = document.getElementById('themeGlyph');

  function getTheme() {
    return root.getAttribute('data-theme') || 'light';
  }
  function setTheme(t) {
    root.setAttribute('data-theme', t);
    if (glyph) glyph.textContent = (t === 'dark') ? '☀️' : '🌙';
    if (btn)   btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
  }

  // Initialize from current data-theme (which head.ejs sets pre-paint)
  setTheme(getTheme());

  // Click handler (ensure it always attaches exactly once)
  if (btn && !btn.__blBound) {
    btn.__blBound = true;
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      var t = getTheme() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, t); } catch (_) {}
      setTheme(t);
    });
  }
})();
