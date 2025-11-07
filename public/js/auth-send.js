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

      const redirectUrl = (location.origin === 'http://localhost:10000')
        ? 'http://localhost:10000/auth/callback'
        : 'https://booklantern.org/auth/callback';

      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl } });
      if(error){ console.error(error); alert('Could not send magic link. Try again.'); return; }
      location.href = '/login?check-email=1';
    });
  }catch(e){ console.error('auth-send', e); }
})();
