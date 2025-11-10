(async function(){
  try{
    const form = document.querySelector('form[action="/auth/magic"], form#magic-login, form[data-magic="1"]') || document.querySelector('form');
    if(!form) return;
    if(form.dataset.bound === '1') return; form.dataset.bound='1';

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const sb = createClient(window.SUPABASE_URL || '', window.SUPABASE_ANON_KEY || '');

    form.addEventListener('submit', async (e)=>{
      const emailInput = form.querySelector('input[type="email"], input[name="email"]');
      if(!emailInput) return;
      e.preventDefault();
      const email = emailInput.value.trim();
      if(!email) return;

      // Force Supabase to redirect to our callback
      const origin = window.location.origin;
      const { error } = await sb.auth.signInWithOtp(
        { email },
        { emailRedirectTo: `${origin}/auth/callback` }
      );
      if(error){ console.error(error); alert('Could not send magic link. Try again.'); return; }
      // Redirect to unified /auth page after sending
      location.href = '/auth?check-email=1';
    });
  }catch(e){ console.error('auth-send', e); }
})();
