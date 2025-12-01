// public/js/session-flag.js
(function () {
  try {
    const cl = (window.supabase && window.supabase.createClient)
      ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
      : null;
    if (!cl) return;

    function setCookie() {
      cl.auth.getSession().then(({ data }) => {
        const t = data?.session?.access_token;
        if (!t) return;
        fetch('/api/auth/session-cookie', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t },
          body: '{}'
        }).catch(()=>{});
      });
    }

    setCookie();
    if (typeof cl.auth.onAuthStateChange === 'function') {
      cl.auth.onAuthStateChange(setCookie);
    }
  } catch (_e) {}
})();
