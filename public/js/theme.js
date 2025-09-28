// Theme toggle: persists choice and updates [data-theme]
(function () {
  function applyTheme(mode) {
    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', '');
    }
  }

  function currentMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function save(mode) {
    try { localStorage.setItem('bl.theme', mode); } catch (e) {}
  }

  function initButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const mode = currentMode();
    btn.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
    btn.innerHTML = mode === 'dark' ? '☀️' : '🌙';

    btn.addEventListener('click', function () {
      const now = currentMode();
      const next = now === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      save(next);
      btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
      btn.innerHTML = next === 'dark' ? '☀️' : '🌙';
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initButton);
  } else {
    initButton();
  }
})();
