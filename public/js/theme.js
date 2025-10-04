// public/js/theme.js
(function () {
  var KEY = 'bl-theme';
  var html = document.documentElement;
  var sw = document.getElementById('themeSwitch');

  function getTheme() {
    try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
  }
  function resolve(mode) {
    if (mode === 'auto') {
      try {
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
      } catch { return 'light'; }
    }
    return mode;
  }
  function apply(mode) {
    html.setAttribute('data-theme', resolve(mode));
  }
  function save(mode) {
    try { localStorage.setItem(KEY, mode); } catch {}
  }

  // init
  var stored = getTheme();
  apply(stored);
  if (sw) {
    // reflect current state on the switch: checked = dark
    sw.checked = resolve(stored) === 'dark';

    sw.addEventListener('change', function () {
      var next = sw.checked ? 'dark' : 'light';
      save(next);
      apply(next);
    });
  }
})();
