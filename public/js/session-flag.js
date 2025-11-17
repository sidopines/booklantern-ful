(function () {
  function postCookie(accessToken) {
    if (!accessToken) return;
    fetch('/api/auth/session-cookie', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + accessToken },
      body: JSON.stringify({ t: Date.now() })
    }).catch(() => {});
  }
  function init(client) {
    if (!client || !client.auth) return;
    client.auth.getSession().then(({ data }) => postCookie(data?.session?.access_token));
    client.auth.onAuthStateChange?.((_evt, session) => postCookie(session?.access_token));
  }
  function start() {
    var url = window.SUPABASE_URL, anon = window.SUPABASE_ANON_KEY;
    if (!url || !anon) return;
    var client = window.supabaseClient ||
      (window.supabase && window.supabase.createClient && window.supabase.createClient(url, anon));
    if (!client) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = function () {
        try { window.supabaseClient = window.supabase.createClient(url, anon); init(window.supabaseClient); } catch (_) {}
      };
      document.head.appendChild(s);
      return;
    }
    window.supabaseClient = client;
    init(client);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
