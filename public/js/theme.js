// BookLantern theme controller (robust)
(function () {
  var KEY = 'bl-theme';
  var root = document.documentElement;
  var btn  = document.getElementById('themeToggle');
  var glyph= document.getElementById('themeGlyph');

  function current() {
    return root.getAttribute('data-theme') || 'light';
  }
  function setTheme(t) {
    root.setAttribute('data-theme', t);
    if (glyph) glyph.textContent = (t === 'dark') ? '☀️' : '🌙';
  }

  // Initialize glyph based on pre-set data-theme (head bootstrap)
  setTheme(current());

  if (btn) {
    btn.addEventListener('click', function () {
      var t = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, t); } catch (_) {}
      setTheme(t);
    });
  }
})();
