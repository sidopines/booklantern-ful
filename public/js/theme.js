(function () {
  var LS_KEY = 'bl-theme';

  function sysPrefersDark() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch (e) { return false; }
  }

  function get() {
    try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
  }

  function set(mode) {
    try { localStorage.setItem(LS_KEY, mode); } catch (e) {}
  }

  function apply(mode) {
    // fallback to system if nothing saved
    if (!mode) mode = sysPrefersDark() ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', mode);
    var icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = (mode === 'dark') ? '🌙' : '☀️';
  }

  // Pre-apply whatever is saved (or system) ASAP
  apply(get());

  // Wire up the button (simple two-state)
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') || (sysPrefersDark() ? 'dark' : 'light');
      var next = current === 'dark' ? 'light' : 'dark';
      set(next);
      apply(next);
    });

    // If user changes OS theme and no explicit choice saved, follow system
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq) {
      mq.addEventListener('change', function () {
        if (!get()) apply(null);
      });
    }
  });
})();
