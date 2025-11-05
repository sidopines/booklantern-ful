// BookLantern auth-flow.js - Magic link sender ONLY
// Token processing happens exclusively on /auth/callback

(function () {
  console.log('[auth-flow] Loaded - this file ONLY sends magic links, does NOT process tokens');
  
  // No token processing here - that happens on /auth/callback
  // This file exists for compatibility but all auth logic is now centralized
  
  if (window.location.pathname === '/auth/callback') {
    console.log('[auth-flow] On /auth/callback - token processing handled by inline script');
  }
})();
