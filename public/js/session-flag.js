/* Sets a lightweight cookie the server can read after Supabase login.
   We do NOT store the Supabase token in a cookie. We just ask the server
   to set a "bl_sub" boolean based on the token we pass once via Authorization. */
(async () => {
  // Load Supabase client if available on pages that include it
  if (typeof window === 'undefined' || !window.supabase) return;

  async function syncCookieFromSession(session) {
    try {
      const token = session?.access_token;
      if (!token) return;
      await fetch('/api/auth/session-cookie', {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}` }
      });
    } catch (e) {
      console.warn('session-cookie sync failed', e);
    }
  }

  // On page load, if already logged in, sync once
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) await syncCookieFromSession(data.session);
  } catch (_) {}

  // Also listen for auth state changes (magic-link completes here)
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) await syncCookieFromSession(session);
  });
})();
