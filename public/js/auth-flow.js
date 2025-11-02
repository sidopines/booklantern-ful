// BookLantern unified auth-flow: handles OAuth (code) + magic-link (hash) returns
(function () {
  // Early: strip ?confirmed=1 (or any "confirmed") to avoid loops from hosted pages
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has('confirmed')) {
      u.searchParams.delete('confirmed');
      history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
    }
  } catch (e) { /* noop */ }

  let sb = window.supabaseClient;
  try {
    if (!sb) {
      const urlMeta  = document.querySelector("meta[name=\"bl-sb-url\"]");
      const keyMeta  = document.querySelector("meta[name=\"bl-sb-anon\"]");
      if (urlMeta && keyMeta && window.supabase && window.supabase.createClient) {
        sb = window.supabase.createClient(urlMeta.content, keyMeta.content, { auth: { persistSession: true, detectSessionInUrl: true } });
        window.supabaseClient = sb;
      }
    }
  } catch (e) { console.error("[auth] bootstrap error", e); }
  if (!sb) return;

  const url  = new URL(window.location.href);
  const next = url.searchParams.get('next') || '/';

  async function handleHashTokens() {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const access  = h.get('access_token');
    const refresh = h.get('refresh_token');
    if (!access || !refresh) return false;

    try {
      const { error } = await sb.auth.setSession({ access_token: access, refresh_token: refresh });
      if (error) { console.error('[auth] setSession error:', error); return false; }
      // Clean up the hash to keep URL pretty
      history.replaceState(null, '', url.pathname + url.search);
      window.location.replace(next);
      return true;
    } catch (e) {
      console.error('[auth] setSession threw:', e);
      return false;
    }
  }

  async function handlePkceCode() {
    const code = url.searchParams.get('code');
    if (!code) return false;

    try {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) { console.error('[auth] exchangeCodeForSession error:', error); return false; }
      // Strip code/error params before moving on
      url.searchParams.delete('code');
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      history.replaceState(null, '', url.pathname + (url.search ? '?'+url.searchParams.toString() : ''));
      window.location.replace(next);
      return true;
    } catch (e) {
      console.error('[auth] exchangeCodeForSession threw:', e);
      return false;
    }
  }

  async function run() {
    // Try hash tokens first (magic link), then PKCE code (OAuth)
    const didHash = await handleHashTokens();
    if (didHash) return;

    const didCode = await handlePkceCode();
    if (didCode) return;

    // No auth params present — nothing to do on load.
  }

  // Run as soon as DOM is ready (some browsers need body to exist for history.replaceState)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
