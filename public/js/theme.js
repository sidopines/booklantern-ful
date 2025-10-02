// public/js/theme.js
(function () {
  var KEY = 'bl-theme'; // 'light' | 'dark' | 'auto'
  var root = document.documentElement;
  var btn = document.querySelector('[data-theme-toggle]');
  var icon = document.querySelector('[data-theme-icon]');

  function currentMode() {
    var stored = localStorage.getItem(KEY);
    if (!stored || stored === 'auto') {
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return prefersDark ? 'dark' : 'light';
    }
    return stored;
  }

  function apply(mode) {
    root.setAttribute('data-theme', mode);
    if (btn) btn.setAttribute('aria-pressed', String(mode === 'dark'));
    if (icon) icon.textContent = mode === 'dark' ? '🌙' : '🌞';
  }

  function toggle() {
    var next = currentMode() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
  }

  // init on load
  apply(currentMode());

  // click wiring
  if (btn) btn.addEventListener('click', toggle);
})();
