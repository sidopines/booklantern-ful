// server.js — CommonJS, explicit route mounting

const path = require('path');
const express = require('express');
const compression = require('compression');
const morgan = require('morgan');

const app = express();

/* --------------------------
   Optional Supabase admin
--------------------------- */
let supabaseAdmin = null;
try {
  supabaseAdmin = require('./supabaseAdmin'); // service role client (may be null if not configured)
} catch {
  supabaseAdmin = null;
}

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

// ---------- Safe locals for EJS ----------
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

  // Expose categories to all views (used by admin books UI, etc.)
  try {
    res.locals.categories = require('./config/categories');
  } catch {
    res.locals.categories = ['trending', 'philosophy', 'history', 'science'];
  }

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
   Account page (passwordless-friendly) — uses views/account.ejs
   ============================================================ */
app.get('/account', (_req, res) => {
  try {
    return res.render('account');
  } catch (e) {
    console.error('[account] render failed:', e);
    return res.status(500).send('Account render error');
  }
});

/* ============================================================
   Admin-only gate middleware
   - Allows if X-Admin-Token matches ADMIN_API_TOKEN
   - Or if Authorization: Bearer <supabase_jwt> belongs to user with app_metadata.role === "admin"
   - Also checks cookies for sb-access-token as a convenience
   ============================================================ */
function parseCookies(cookieHeader = '') {
  const out = {};
  cookieHeader.split(';').forEach((p) => {
    const idx = p.indexOf('=');
    if (idx > -1) {
      const k = p.slice(0, idx).trim();
      const v = decodeURIComponent(p.slice(idx + 1).trim());
      out[k] = v;
    }
  });
  return out;
}

async function isAdminFromSupabaseToken(token) {
  if (!token || !supabaseAdmin || !supabaseAdmin.auth || !supabaseAdmin.auth.getUser) {
    return false;
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data || !data.user) return false;
    const role = data.user.app_metadata && data.user.app_metadata.role;
    return role === 'admin';
  } catch {
    return false;
  }
}

async function adminGate(req, res, next) {
  try {
    // 1) Fast path: header token for admin API
    const presented = req.get('X-Admin-Token') || '';
    const configured = process.env.ADMIN_API_TOKEN || '';
    if (configured && presented && presented === configured) {
      return next();
    }

    // 2) Try Supabase JWT (Authorization: Bearer <token>)
    let bearer = '';
    const authz = req.headers.authorization || '';
    if (authz.toLowerCase().startsWith('bearer ')) {
      bearer = authz.slice(7).trim();
    }

    // 3) Try cookies for sb-access-token or access_token
    if (!bearer && req.headers.cookie) {
      const cookies = parseCookies(req.headers.cookie);
      bearer = cookies['sb-access-token'] || cookies['access_token'] || '';
    }

    if (await isAdminFromSupabaseToken(bearer)) {
      return next();
    }

    // 4) Otherwise block
    res.status(403).send(
      '<!doctype html><meta charset="utf-8"><title>Forbidden</title>' +
      '<style>body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;margin:3rem;color:#111}' +
      '.card{max-width:640px;border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.06)}</style>' +
      '<main class="card"><h1>Forbidden</h1><p>You need admin access to view this page.</p>' +
      '<p><a href="/login">Sign in</a> with an admin account, or contact the site owner.</p></main>'
    );
  } catch (e) {
    console.error('[adminGate] error:', e);
    res.status(403).send('Forbidden');
  }
}

// Mount the admin gate for ALL /admin/* routes (must be before routers)
app.use('/admin', adminGate);

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

// NEW: dedicated admin content routers (books, videos, genres)
try {
  const adminBooks = require('./routes/admin-books');
  app.use('/admin/books', adminBooks);
  console.log('[routes] mounted admin-books router');
} catch (e) {
  console.error('[routes] failed to mount admin-books:', e);
}

try {
  const adminVideos = require('./routes/admin-videos');
  app.use('/admin/videos', adminVideos);
  console.log('[routes] mounted admin-videos router');
} catch (e) {
  console.error('[routes] failed to mount admin-videos:', e);
}

try {
  const adminVideoGenres = require('./routes/admin-video-genres');
  app.use('/admin/genres', adminVideoGenres);
  console.log('[routes] mounted admin-video-genres router');
} catch (e) {
  console.error('[routes] failed to mount admin-video-genres:', e);
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
