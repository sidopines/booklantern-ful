(function(){
  try {
    if (location.pathname === '/login' || location.pathname === '/register') {
      if (location.hash && location.hash.includes('access_token')) {
        // Send the entire hash through to the callback
        location.replace('/auth/callback' + location.hash);
      }
    }
  } catch(e) {
    console.error('auth-bridge error', e);
  }
})();
