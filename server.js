// server.js — CommonJS, explicit route mounting

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');

const app = express();

// ---------- Express core ----------
app.set('trust proxy', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- Static assets ----------
app.use(
  '/public',
  express.static(path.join(__dirname, 'public'), {
    maxAge: '1y',
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

// Service worker at scope /
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sw.js'), {
    headers: { 'Content-Type': 'application/javascript' },
  });
});

// Minimal robots.txt to avoid 404 noise
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\n');
});

// ---------- Safe locals for EJS (theme/footer rely on buildId) ----------
const BUILD_ID = Date.now().toString();
app.use((req, res, next) => {
  res.locals.isAuthenticated = Boolean(
    (req.session && req.session.user) || req.user || req.authUser
  );
  res.locals.user =
    (req.session && req.session.user) || req.user || req.authUser || null;

  res.locals.buildId = BUILD_ID;
  res.locals.pageDescription =
    'Millions of free books from globally trusted libraries. One clean reader.';

  next();
});

/* ============================================================
   Direct Supabase callback route before other routers.
   Handles magic link / recovery / email confirm flows.
   ============================================================ */
app.get(/^\/auth\/callback(?:\/.*)?$/, (req, res) => {
  try {
    const canonicalUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    return res.render('auth-callback', { canonicalUrl });
  } catch (e) {
    console.error('[auth-callback] render failed:', e);
    return res.status(500).send('Auth callback error');
  }
});

/* ============================================================
   Account page (passwordless-friendly) with Profile editor.
   Uses supabase-js in the browser with RLS policies in DB.
   Expects table public.profiles (id=auth.uid()) and policies.
   ============================================================ */
app.get('/account', (_req, res) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Account • BookLantern</title>

  <link rel="stylesheet" href="/public/css/site.css?v=${BUILD_ID}">
  <link rel="stylesheet" href="/public/css/nav.css?v=${BUILD_ID}">
  <link rel="stylesheet" href="/public/css/footer.css?v=${BUILD_ID}">

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    // Same env injection style as head.ejs
    window.__SB_URL = "${process.env.SUPABASE_URL || ''}";
    window.__SB_ANON = "${process.env.SUPABASE_ANON_KEY || ''}";
    window.supabaseClient = (window.__SB_URL && window.__SB_ANON)
      ? (window.supabase && window.supabase.createClient
          ? window.supabase.createClient(window.__SB_URL, window.__SB_ANON)
          : supabase.createClient(window.__SB_URL, window.__SB_ANON))
      : null;
  </script>

  <style>
    .container{max-width:780px;margin:28px auto;padding:0 16px}
    .card{background:var(--surface,#fff);border:1px solid rgba(0,0,0,.06);border-radius:12px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .stack{display:flex;flex-direction:column;gap:10px}
    .btn{padding:10px 14px;border-radius:8px;border:0;cursor:pointer;background:#f3f4f6}
    .btn-primary{background:#6366f1;color:#fff}
    .btn-danger{background:#ef4444;color:#fff}
    .input{width:100%;padding:10px 12px;border:1px solid var(--ink-3,#d1d5db);border-radius:8px}
    .checkbox-row{display:flex;gap:10px;align-items:center}
    .ink-2{color:#6b7280}
    header .nav{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:12px 16px}
    header .brand{margin-right:auto;text-decoration:none;font-weight:700}
    .sep{margin:16px 0;border:0;border-top:1px solid rgba(0,0,0,.08)}
    .badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#e5e7eb}
    .success{color:#065f46}
    .error{color:#991b1b}
  </style>
</head>
<body>
  <header class="site-header">
    <div class="nav">
      <a class="brand" href="/">BookLantern</a>
      <a class="btn" href="/">Home</a>
      <button id="signOutTop" class="btn">Sign out</button>
    </div>
  </header>

  <main class="container">
    <h1>Account</h1>
    <p id="state" class="ink-2">Checking your session…</p>

    <section id="card" class="card" style="display:none">
      <div class="stack">
        <div class="row">
          <span class="ink-2">Signed in as</span>
          <strong id="email" class="badge"></strong>
        </div>

        <hr class="sep">

        <h3>Profile</h3>
        <label class="stack">
          <span class="ink-2">Display name</span>
          <input id="displayName" class="input" type="text" placeholder="e.g., Jane Doe">
        </label>

        <label class="checkbox-row">
          <input id="newsletter" type="checkbox">
          <span>Newsletter</span>
        </label>

        <label class="checkbox-row">
          <input id="productUpdates" type="checkbox">
          <span>Product updates</span>
        </label>

        <div class="row" style="margin-top:6px">
          <button id="save" class="btn btn-primary">Save changes</button>
          <span id="saveMsg" class="ink-2" aria-live="polite"></span>
        </div>

        <hr class="sep">

        <h3>Quick actions</h3>
        <div class="row">
          <button id="sendLink" class="btn">Email me a magic sign-in link</button>
          <button id="signOut" class="btn">Sign out</button>
        </div>

        <!-- Optional, hidden by default for safety -->
        <details style="margin-top:8px">
          <summary class="ink-2">Danger zone</summary>
          <p class="ink-2">Deleting your profile is permanent.</p>
          <button id="deleteProfile" class="btn btn-danger">Delete my profile</button>
          <span id="deleteMsg" class="ink-2"></span>
        </details>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">BookLantern © 2025</div>
  </footer>

  <script>
    (async function(){
      const sb = window.supabaseClient;
      const state = document.getElementById('state');
      const card  = document.getElementById('card');
      const emailEl = document.getElementById('email');

      const displayName = document.getElementById('displayName');
      const newsletter  = document.getElementById('newsletter');
      const productUpd  = document.getElementById('productUpdates');
      const saveBtn     = document.getElementById('save');
      const saveMsg     = document.getElementById('saveMsg');

      const sendLinkBtn = document.getElementById('sendLink');
      const soTop = document.getElementById('signOutTop');
      const so    = document.getElementById('signOut');

      const delBtn = document.getElementById('deleteProfile');
      const delMsg = document.getElementById('deleteMsg');

      async function requireUser(){
        if(!sb || !sb.auth || !sb.auth.getUser){
          state.textContent = 'Auth not available. Please refresh.';
          return null;
        }
        const { data: { user }, error } = await sb.auth.getUser();
        if (error) { state.textContent = error.message; return null; }
        if (!user) { location.href = '/login'; return null; }
        return user;
      }

      async function loadProfile(user){
        // Ensure a row exists (trigger you added should do this, but be defensive).
        await sb.from('profiles').upsert({ id: user.id }, { onConflict: 'id' });

        const { data, error } = await sb
          .from('profiles')
          .select('display_name, newsletter, product_updates')
          .eq('id', user.id)
          .single();

        if (error) { console.warn(error); return; }
        displayName.value       = data?.display_name || '';
        newsletter.checked      = !!data?.newsletter;
        productUpd.checked      = data?.product_updates !== false; // default true
      }

      async function boot(){
        try{
          const user = await requireUser();
          if (!user) return;

          emailEl.textContent = user.email || '(unknown)';
          state.textContent = 'You are signed in.';
          card.style.display = 'block';

          await loadProfile(user);

          // Save profile
          saveBtn.addEventListener('click', async function(){
            saveMsg.textContent = 'Saving…';
            const { error } = await sb.from('profiles').update({
              display_name: displayName.value || null,
              newsletter: !!newsletter.checked,
              product_updates: !!productUpd.checked
            }).eq('id', user.id);

            saveMsg.textContent = error ? ('❌ ' + error.message) : '✅ Saved!';
            setTimeout(()=>{ saveMsg.textContent=''; }, 2200);
          });

          // Send a magic sign-in link to current email
          sendLinkBtn.addEventListener('click', async function(){
            state.textContent = 'Sending sign-in link…';
            const redirectTo = location.origin + '/auth/callback?type=magiclink';
            const { error } = await sb.auth.signInWithOtp({ email: user.email, options: { emailRedirectTo: redirectTo } });
            state.textContent = error ? ('❌ ' + error.message) : 'Magic link sent to your email.';
            setTimeout(()=>{ state.textContent = 'You are signed in.'; }, 2500);
          });

          async function signOut(){
            try { await sb.auth.signOut(); } catch {}
            location.href = '/';
          }
          soTop.addEventListener('click', signOut);
          so.addEventListener('click', signOut);

          // Optional: delete profile (keeps auth.user; only deletes public profile)
          delBtn.addEventListener('click', async function(){
            if (!confirm('Delete your profile? This cannot be undone.')) return;
            delMsg.textContent = 'Deleting…';
            const { error } = await sb.from('profiles').delete().eq('id', user.id);
            delMsg.textContent = error ? ('❌ ' + error.message) : '✅ Profile deleted.';
          });

        }catch(e){
          state.textContent = 'Could not load account. Please try again.';
        }
      }

      boot();
    })();
  </script>
</body>
</html>`;
  res.status(200).send(html);
});

// ---------- Mount routes explicitly ----------
// Mount the auth shim FIRST so its exact paths (/auth/callback, /login, /register, /account) win.
try {
  const loginShim = require('./routes/loginShim');
  app.use('/', loginShim);
  console.log('[routes] mounted loginShim router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/loginShim:', e);
}

try {
  const indexRoutes = require('./routes/index'); // exports an express.Router()
  app.use('/', indexRoutes);
  console.log('[routes] mounted index router at /');
} catch (e) {
  console.error('[routes] failed to mount ./routes/index:', e);
}

try {
  const adminRoutes = require('./routes/admin'); // exports an express.Router()
  app.use('/admin', adminRoutes);
  console.log('[routes] mounted admin router at /admin');
} catch (e) {
  console.error('[routes] failed to mount ./routes/admin:', e);
}

// ---------- Health check ----------
app.get('/healthz', (_req, res) => res.status(200).send('OK'));

// ---------- 404 ----------
app.use((req, res) => {
  try {
    res.status(404).render('404');
  } catch {
    res.status(404).send('Not Found');
  }
});

// ---------- 500 ----------
app.use((err, req, res, _next) => {
  console.error('🔥 Unhandled error:', err);
  try {
    res.status(500).render('error', { error: err });
  } catch {
    res.status(500).send('Internal Server Error');
  }
});

// ---------- Start ----------
const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);
});
