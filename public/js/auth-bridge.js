(function(){
  try{
    if((location.pathname==='/login' || location.pathname==='/register') && location.hash.includes('access_token')){
      location.replace('/auth/callback'+location.hash);
    }
  }catch(e){ console.error('auth-bridge',e); }
})();
