// public/js/theme.js
// Cycles between: light -> dark -> system (follow device)
// Persists to localStorage and updates the button label.

(function () {
  var root = document.documentElement;
  var STORAGE_KEY = 'bl.theme'; // 'light' | 'dark' | 'system'

  function getSaved() {
    try { return localStorage.getItem(STORAGE_KEY) || 'system'; }
    catch { return 'system'; }
  }

  function save(mode) {
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
  }

  function apply(mode) {
    if (mode === 'light' || mode === 'dark') {
      root.setAttribute('data-theme', mode);
    } else {
      root.removeAttribute('data-theme'); // system
    }
    updateButton(mode);
  }

  function nextMode(current) {
    return current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
  }

  function updateButton(mode) {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var label = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Auto';
    btn.textContent = label;
    btn.setAttribute('data-mode', mode);
    btn.setAttribute('aria-label', 'Theme: ' + label);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;

    var current = getSaved();
    apply(current);

    btn.addEventListener('click', function () {
      var mode = nextMode(btn.getAttribute('data-mode') || 'system');
      save(mode);
      apply(mode);
    });

    // If user selected "system", react to OS changes too
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', function () {
      if (getSaved() === 'system') apply('system');
    });
  });
})();
