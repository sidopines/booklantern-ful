// public/js/theme.js
// BookLantern theme controller: light / dark / auto
// - Persists choice in localStorage("theme") as "light" | "dark" | "auto"
// - Applies data-theme on <html>
// - Syncs icon (🌙 for dark target, ☀️ for light target)
// - Respects system Prefers-Color-Scheme when "auto"

(function () {
  const STORAGE_KEY = 'theme'; // "light" | "dark" | "auto"
  const html = document.documentElement;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  // Elements (footer toggle is standard; support optional navbar toggle too)
  const btn = document.getElementById('themeToggle') || document.querySelector('[data-theme-toggle]');
  const icon = document.getElementById('themeIcon') || document.querySelector('[data-theme-icon]');

  // ---- Core ----
  function getStored() {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
  }

  function effective(theme) {
    // what actually gets rendered right now (light/dark)
    if (theme === 'light') return 'light';
    if (theme === 'dark') return 'dark';
    return mq.matches ? 'dark' : 'light'; // auto
  }

  function apply(theme) {
    // theme param is "light" | "dark" | "auto"
    // Set attribute to "light" or "dark" for CSS, keep the *selection* in data-theme-pref
    const eff = effective(theme);
    html.setAttribute('data-theme', eff);         // for CSS
    html.setAttribute('data-theme-pref', theme);  // for debugging / reading current pref
    if (icon) icon.textContent = eff === 'dark' ? '☀️' : '🌙'; // show the target you’d switch to
    // Update button accessible label
    if (btn) btn.setAttribute('aria-label', `Switch to ${eff === 'dark' ? 'light' : 'dark'} theme`);
  }

  function save(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
  }

  // Rotate: light -> dark -> auto -> light ...
  function nextTheme(current) {
    if (current === 'light') return 'dark';
    if (current === 'dark') return 'auto';
    return 'light'; // auto -> light
  }

  // ---- Init ----
  const initial = getStored();
  apply(initial);

  // If system scheme changes while in "auto", update live
  mq.addEventListener('change', () => {
    if (getStored() === 'auto') apply('auto');
  });

  // Click handler
  if (btn) {
    btn.addEventListener('click', () => {
      const curr = getStored();
      const next = nextTheme(curr);
      save(next);
      apply(next);
    });
  }

  // Expose tiny API if other scripts need it
  window.BLTheme = {
    get: getStored,             // returns "light" | "dark" | "auto"
    set: (t) => { save(t); apply(t); }, // set & apply
    apply,                      // apply current pref to DOM
  };
})();
