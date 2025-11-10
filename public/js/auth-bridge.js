// Auth bridge - forward hash tokens to /auth/callback
// Run immediately on page load
(function(){
  try{
    // If there's a token in the hash, jump to callback immediately
    if (location.hash && /access_token=/.test(location.hash)) {
      console.log('[auth-bridge] Token detected in hash, forwarding to /auth/callback');
      location.replace(`/auth/callback${location.hash}`);
      return;
    }

    // Fallback: handle specific auth pages
    const path = location.pathname;
    if((path==='/auth' || path==='/login' || path==='/register') && location.hash.includes('access_token')){
      console.log('[auth-bridge] Forwarding tokens from', path, 'to /auth/callback');
      location.replace('/auth/callback'+location.hash);
    }
  }catch(e){ console.error('[auth-bridge] error', e); }
})();
