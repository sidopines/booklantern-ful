/* Bridge legacy /login#access_token=… to /auth/callback#… (server can't see fragments) */
(function(){
  try {
    if (location.pathname === '/login' || location.pathname === '/register') {
      if (location.hash && location.hash.includes('access_token')) {
        location.replace('/auth/callback' + location.hash);
      }
    }
  } catch(e) { /* no-op */ }
})();
