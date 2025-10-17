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
   FIX: Direct Supabase callback route before other routers.
   This prevents redirects like /login?reset=1#.
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
   Minimal Account page (works with passwordless sign-in).
   Uses supabase-js in the browser to read the current session.
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
    // Same env injection style as your head.ejs
    window.__SB_URL = "${process.env.SUPABASE_URL || ''}";
    window.__SB_ANON = "${process.env.SUPABASE_ANON_KEY || ''}";
    window.supabaseClient = (window.__SB_URL && window.__SB_ANON)
      ? supabase.createClient(window.__SB_URL, window.__SB_ANON)
      : null;
  </script>
  <style>
    .container{max-width:720px;margin:28px auto;padding:0 16px}
    .card{background:var(--surface,#fff);border:1px solid rgba(0,0,0,.06);border-radius:12px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .btn{padding:10px 14px;border-radius:8px;border:0;cursor:pointer;background:#f3f4f6}
    .btn-primary{background:#6366f1;color:#fff}
    .ink-2{color:#6b7280}
    header .nav{display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:12px 16px}
    header .brand{margin-right:auto;text-decoration:none;font-weight:700}
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
      <div class="row">
        <span class="ink-2">Signed in as</span>
        <strong id="email"></strong>
      </div>
      <div class="row" style="margin-top:12px">
        <button id="signOut" class="btn">Sign out</button>
        <a class="btn" href="/">Go to homepage</a>
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
      const soTop = document.getElementById('signOutTop');
      const so = document.getElementById('signOut');

      async function boot(){
        try{
          if(!sb || !sb.auth || !sb.auth.getUser){
            state.textContent = 'Auth not available. Please refresh.';
            return;
          }
          const { data: { user } } = await sb.auth.getUser();
          if(!user){
            // Not signed in -> return to login
            location.href = '/login';
            return;
          }
          emailEl.textContent = user.email || '(unknown)';
          state.textContent = 'You are signed in.';
          card.style.display = 'block';
        }catch(e){
          state.textContent = 'Could not read session. Please try again.';
        }
      }

      async function signOut(){
        try { await (sb && sb.auth && sb.auth.signOut ? sb.auth.signOut() : Promise.resolve()); } catch {}
        location.href = '/';
      }

      soTop.addEventListener('click', signOut);
      so.addEventListener('click', signOut);

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
