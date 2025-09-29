// server.js — Supabase + robustness pass
require('dotenv').config();

const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const cookieSession = require('cookie-session');
const csrf = require('csurf');
const fetch = require('node-fetch'); // v2
// ❌ removed: const { AbortController } = require('abort-controller');
const NodeCache = require('node-cache');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 10000;
const BUILD_ID = Date.now().toString();

// ---- Supabase clients ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE) {
  console.warn('⚠️  Missing Supabase env vars. Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE.');
}
const supabaseAnon  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

// ---- Express base setup ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Sessions
app.set('trust proxy', 1);
const keys = (process.env.SESSION_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!keys.length) {
  console.warn('⚠️  SESSION_KEYS not set. Using a weak fallback key (dev only).');
  keys.push('dev-only-key');
}
app.use(cookieSession({
  name: 'bl.sess',
  keys,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  maxAge: 1000 * 60 * 60 * 24 * 30 // 30 days
}));

// ---- Static files
// Serve /public at ROOT so /sw.js, /site.webmanifest, /favicon.ico resolve.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
// Also keep legacy /public/* paths:
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// ---- Locals
app.use((req, res, next) => {
  res.locals.buildId = BUILD_ID;
  res.locals.user = req.session.user || null;
  res.locals.isAuthenticated = !!req.session.user;
  res.locals.isAdmin = !!(req.session.user && req.session.user.role === 'admin');
  res.locals.loggedIn = res.locals.isAuthenticated; // alias for legacy templates
  res.locals.referrer = req.get('referer') || '/';
  next();
});

// CSRF (cookie mode)
const csrfProtection = csrf({
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
});

// ----------------------
// Auth helpers
// ----------------------
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Forbidden' });
  }
  next();
};

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

// ----------------------
// Cache
// ----------------------
const cache = new NodeCache({ stdTTL: 60 * 30 }); // 30 min

// ----------------------
// Pages
// ----------------------
app.get('/', async (req, res) => {
  try {
    const trending   = await pickSomeBooks('trending');
    const philosophy = await pickSomeBooks('philosophy');
    const history    = await pickSomeBooks('history');
    return res.render('index', { pageTitle: 'BookLantern', trending, philosophy, history });
  } catch (e) {
    console.error('Home error:', e);
    return res.render('error', { message: 'Unexpected error' });
  }
});

app.get('/about',   (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));

// Watch (avoid undefined variable in template)
app.get('/watch', (req, res) => {
  res.render('watch', { videos: [] });
});

// Auth
app.get('/login', csrfProtection, (req, res) => {
  res.render('login', { csrfToken: req.csrfToken(), next: req.query.next || '/' });
});
app.post('/login', csrfProtection, async (req, res) => {
  const { email, password, next } = req.body;
  try {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).render('login', { csrfToken: req.csrfToken(), error: error.message, next: next || '/' });

    const user = data.user;
    let role = 'user';
    const { data: prof } = await supabaseAdmin.from('profiles').select('role,name').eq('id', user.id).single();
    if (prof && prof.role) role = prof.role;
    if (!prof) await supabaseAdmin.from('profiles').insert({ id: user.id, email: user.email, role });

    req.session.user = { id: user.id, email: user.email, role };
    return res.redirect(next || '/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).render('login', { csrfToken: req.csrfToken(), error: 'Login failed', next: next || '/' });
  }
});

app.get('/register', csrfProtection, (req, res) => {
  res.render('register', { csrfToken: req.csrfToken(), next: req.query.next || '/' });
});
app.post('/register', csrfProtection, async (req, res) => {
  const { name, email, password, next } = req.body;
  try {
    const { data, error } = await supabaseAnon.auth.signUp({ email, password, options: { data: { name } } });
    if (error) return res.status(400).render('register', { csrfToken: req.csrfToken(), error: error.message, next: next || '/' });

    const user = data.user;
    if (!user) {
      return res.render('register', { csrfToken: req.csrfToken(), success: 'Please check your email to confirm your account.', next: next || '/' });
    }
    const role = ADMIN_EMAILS.has(email.toLowerCase()) ? 'admin' : 'user';
    await supabaseAdmin.from('profiles').insert({ id: user.id, email, name, role });

    req.session.user = { id: user.id, email: user.email, role };
    return res.redirect(next || '/dashboard');
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).render('register', { csrfToken: req.csrfToken(), error: 'Registration failed', next: next || '/' });
  }
});

app.post('/logout', (req, res) => { req.session = null; res.redirect('/'); });

app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { pageTitle: 'Your Library' });
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.render('admin', { pageTitle: 'Admin' });
});

// Reader
app.get('/read/:provider/:id', requireAuth, (req, res) => {
  res.render('read', { provider: req.params.provider, id: req.params.id, pageTitle: 'Read - BookLantern' });
});

// Search
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.redirect('/');
  try {
    const results = await searchAcrossProviders(q);
    return res.render('search', { q, results });
  } catch (e) {
    console.error('Search error:', e);
    return res.render('search', { q, results: [] });
  }
});

// ----------------------------------------------------
// Robust /proxy with timeout + small retry + UA header
// ----------------------------------------------------
const PROXY_TTL = 60 * 60; // 1 hour
const proxyCache = new NodeCache({ stdTTL: PROXY_TTL });

app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url');

    const cacheKey = `proxy:${url}`;
    const cached = proxyCache.get(cacheKey);
    if (cached) {
      res.set('Content-Type', cached.ct || 'application/octet-stream');
      return res.send(cached.buf);
    }

    const buf = await fetchWithTimeoutAndRetry(url, {
      headers: { 'User-Agent': 'BookLantern/1.0 (+https://booklantern.org)' }
    }, 8000, 1); // 8s timeout, 1 retry

    const { data, contentType } = buf;
    res.set('Content-Type', contentType || 'application/octet-stream');
    proxyCache.set(cacheKey, { buf: data, ct: contentType });
    return res.send(data);
  } catch (e) {
    console.error('Proxy error:', e);
    return res.status(500).end();
  }
});

// API: book content
app.get('/api/book', requireAuth, async (req, res) => {
  const { provider, id } = req.query;
  try {
    const key = `bk:${provider}:${id}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const data = await fetchFromProvider(provider, id);
    cache.set(key, data, 60 * 15);
    res.json(data);
  } catch (e) {
    console.error('/api/book error:', e);
    res.status(500).json({ error: 'Failed to fetch book' });
  }
});

// ----------------------
// Errors / 404
// ----------------------
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', { message: 'Invalid CSRF token' });
  }
  console.error('🔥 Unhandled error:', err);
  return res.status(500).render('error', { message: 'Unexpected error' });
});
app.use((req, res) => res.status(404).render('404'));

// ----------------------
// Start
// ----------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('✅ Connected to Supabase');
});

// ======================================================
// Helpers
// ======================================================

// Small timeout+retry fetch that also returns content-type
async function fetchWithTimeoutAndRetry(url, options = {}, timeoutMs = 8000, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController(); // global in Node 20
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      const data = await r.buffer();
      return { data, contentType: ct };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt === retries) break;
    }
  }
  throw lastErr;
}

// Replace relative "images/.." etc. inside Gutenberg HTML with absolute proxied URLs
function rewritePgHtml(html, id) {
  const base = `https://www.gutenberg.org/files/${id}/${id}-h/`;
  return html
    .replace(/(src|href)="\.?\/?images\/([^"]+)"/g, (_m, attr, file) =>
      `${attr}="/proxy?url=${encodeURIComponent(base + 'images/' + file)}"`)
    .replace(/(src|href)="(?!https?:\/\/)([^"]+)"/g, (_m, attr, rel) =>
      `${attr}="/proxy?url=${encodeURIComponent(base + rel)}"`);
}

// Homepage picks with real metadata (Gutendex)
async function pickSomeBooks(kind) {
  const per = 10;
  const ids = {
    trending:  ['64176','58988','58596','56517','26659','10471','7142','6593','14328','42983'],
    philosophy:['42884','66638','10643','11431','47204','5827','47204','10471','64176','58596'],
    history:   ['64176','47204','10471','26659','56517','14328','6593','7142','58988','42983']
  }[kind] || [];

  const list = await Promise.all(ids.slice(0, per).map(async (gid) => {
    try {
      const r = await fetch(`https://gutendex.com/books/${gid}`);
      if (r.ok) {
        const b = await r.json();
        const cover = b.formats?.['image/jpeg'] || null;
        return {
          provider: 'pg',
          id: String(b.id),
          title: b.title || `PG #${gid}`,
          author: (b.authors && b.authors[0] && b.authors[0].name) || '',
          cover: cover ? `/proxy?url=${encodeURIComponent(cover)}`
                       : `/proxy?url=${encodeURIComponent(`https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`)}`
        };
      }
    } catch (_) {}
    return {
      provider: 'pg',
      id: gid,
      title: `Project Gutenberg #${gid}`,
      author: '',
      cover: `/proxy?url=${encodeURIComponent(`https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`)}`
    };
  }));
  return list;
}

// Multi-source search (OL + Gutenberg)
async function searchAcrossProviders(q) {
  const out = [];

  // Open Library
  try {
    const r = await fetch(`https://openlibrary.org/search.json?limit=12&q=${encodeURIComponent(q)}`);
    if (r.ok) {
      const j = await r.json();
      (j.docs || []).slice(0, 12).forEach(d => {
        const wid = d.key?.replace('/works/', '');
        if (!wid) return;
        out.push({
          provider: 'ol',
          id: wid,
          title: d.title || wid,
          author: (d.author_name && d.author_name[0]) || '',
          cover: d.cover_i ? `/proxy?url=${encodeURIComponent(`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`)}` : null
        });
      });
    }
  } catch {}

  // Gutendex (Gutenberg)
  try {
    const r = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(q)}`);
    if (r.ok) {
      const j = await r.json();
      (j.results || []).slice(0, 12).forEach(b => {
        out.push({
          provider: 'pg',
          id: String(b.id),
          title: b.title,
          author: (b.authors && b.authors[0] && b.authors[0].name) || '',
          cover: b.formats['image/jpeg'] ? `/proxy?url=${encodeURIComponent(b.formats['image/jpeg'])}` : null
        });
      });
    }
  } catch {}

  return out;
}

// Fetch reader payload
async function fetchFromProvider(provider, id) {
  if (provider === 'pg') {
    const htmlUrl1 = `https://www.gutenberg.org/files/${id}/${id}-h/${id}-h.htm`;
    const htmlUrl2 = `https://www.gutenberg.org/files/${id}/${id}-h/${id}-h.html`;
    const txtUrl   = `https://www.gutenberg.org/files/${id}/${id}.txt`;

    const html = await tryFetchText([htmlUrl1, htmlUrl2], 9000);
    if (html) {
      const fixed = rewritePgHtml(html, id);
      return { type: 'html', title: `Project Gutenberg #${id}`, content: fixed };
    }
    const plain = await tryFetchText([txtUrl], 9000);
    if (plain) return { type: 'text', title: `Project Gutenberg #${id}`, content: plain };
    return { type: 'error', error: 'Not found' };
  }

  if (provider === 'ol') {
    try {
      const work = await (await fetch(`https://openlibrary.org/works/${id}.json`)).json();
      const title = work?.title || id;
      const text = `<h1>${title}</h1><p>Open Library work page: <a href="https://openlibrary.org/works/${id}" target="_blank" rel="noopener">openlibrary.org</a></p>`;
      return { type: 'html', title, content: text };
    } catch {
      return { type: 'error', error: 'Open Library fetch failed' };
    }
  }

  if (provider === 'ia') {
    const text = `<p>Internet Archive item: ${id}. (Embed/derivative fetch can be added here.)</p>`;
    return { type: 'html', title: `IA ${id}`, content: text };
  }

  return { type: 'error', error: 'Unknown provider' };
}

async function tryFetchText(urls, timeoutMs = 9000) {
  for (const u of urls) {
    try {
      const controller = new AbortController(); // global
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const r = await fetch(u, {
        signal: controller.signal,
        headers: { 'User-Agent': 'BookLantern/1.0 (+https://booklantern.org)' }
      });
      clearTimeout(t);
      if (r.ok) return await r.text();
    } catch (_) {}
  }
  return null;
}
