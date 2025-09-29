(function () {
  var LS_KEY = 'bl-theme';

  function apply(mode) {
    if (mode === 'auto') {
      try {
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        mode = prefersDark ? 'dark' : 'light';
      } catch (e) { mode = 'light'; }
    }
    document.documentElement.setAttribute('data-theme', mode);
    var icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = (mode === 'dark') ? '🌙' : '☀️';
  }

  function current() {
    try { return localStorage.getItem(LS_KEY) || 'auto'; }
    catch (e) { return 'auto'; }
  }

  function set(mode) {
    try { localStorage.setItem(LS_KEY, mode); } catch (e) {}
    apply(mode);
  }

  // Initialize on DOM ready (pre-paint script in head already set data-theme)
  document.addEventListener('DOMContentLoaded', function () {
    apply(current());

    var btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', function () {
        var m = current();
        var next = (m === 'light') ? 'dark' : (m === 'dark') ? 'auto' : 'light';
        set(next);
      });
    }

    // If user changes system theme and we're in auto, reflect it
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq) {
      mq.addEventListener('change', function () {
        if (current() === 'auto') apply('auto');
      });
    }
  });
})();
