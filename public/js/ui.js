// public/js/ui.js
(function () {
  var root = document.documentElement;
  var btn  = null;

  function setLabel(theme) {
    if (!btn) return;
    // show the icon for the *next* theme
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = 'Switch to ' + (theme === 'light' ? 'dark' : 'light') + ' theme';
    btn.setAttribute('aria-label', btn.title);
  }

  function getTheme() {
    try {
      var saved = localStorage.getItem('bl-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch (e) {}
    return root.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem('bl-theme', theme); } catch (e) {}
    setLabel(theme);
  }

  function toggleTheme() {
    var cur = getTheme();
    applyTheme(cur === 'light' ? 'dark' : 'light');
  }

  // Wait for DOM to mount to find the button
  window.addEventListener('DOMContentLoaded', function () {
    btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', toggleTheme);
      setLabel(getTheme()); // initialize label
    }
  });
})();
