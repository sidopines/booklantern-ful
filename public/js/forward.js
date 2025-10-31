// public/js/forward.js — extra safety net for moving hash to /auth/callback
(function(){
  try {
    var s = location.search || "";
    var h = location.hash || "";
    var tgt = "/auth/callback" + s + h;

    // If we somehow loaded this file while not on /login?confirmed=...
    if (location.pathname !== '/auth/callback' && /(^#|[&#])(access_token|refresh_token|type=|code=)/i.test(h)) {
      try { location.assign(tgt); } catch(_) {}
      try { if (location.pathname !== "/auth/callback") location.replace(tgt); } catch(_) {}
      try { if (location.pathname !== "/auth/callback") location.href = tgt; } catch(_) {}
      setTimeout(function(){ if (location.pathname !== "/auth/callback") location.href = tgt; }, 150);
    }
  } catch (e) {
    // last resort
    try { location.href = "/auth/callback"; } catch(_){}
  }
})();
