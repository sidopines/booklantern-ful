// public/js/ui.js

(function () {
  // THEME TOGGLE ---------------------------------------------
  var root = document.documentElement;
  var toggleBtn = document.getElementById('themeToggle');

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') {
      root.dataset.theme = t;
      try { localStorage.setItem('bl-theme', t); } catch (e) {}
      if (toggleBtn) toggleBtn.setAttribute('aria-label', 'Switch to ' + (t === 'light' ? 'dark' : 'light') + ' theme');
    }
  }

  function currentTheme() {
    var saved;
    try { saved = localStorage.getItem('bl-theme'); } catch (e) {}
    if (saved === 'light' || saved === 'dark') return saved;
    // default to light if not set
    return 'light';
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      applyTheme(next);
    });
  }

  // Ensure theme is applied on load (in case head inline script didn't)
  applyTheme(currentTheme());
})();
