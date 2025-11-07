// Auth bridge - forward hash tokens to /auth/callback
(function(){
  try{
    const path = location.pathname;
    if((path==='/login' || path==='/register') && location.hash.includes('access_token')){
      console.log('[auth-bridge] Forwarding tokens to /auth/callback');
      location.replace('/auth/callback'+location.hash);
    }
  }catch(e){ console.error('[auth-bridge] error', e); }
})();
