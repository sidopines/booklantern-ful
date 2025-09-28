// server.js — Supabase edition + Service Worker route
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

const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
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

// Static
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// Serve Service Worker from root scope -> /sw.js (file lives in /public/sw.js)
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Locals for all views
app.use((req, res, next) => {
  res.locals.buildId = BUILD_ID;
  res.locals.user = req.session.user || null;
  res.locals.isAuthenticated = !!req.session.user;
  res.locals.isAdmin = !!(req.session.user && req.session.user.role === 'admin');
  res.locals.loggedIn = res.locals.isAuthenticated; // legacy alias
  res.locals.referrer = req.get('referer') || '/';
  next();
});

// CSRF (cookies)
const csrfProtection = csrf({
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
});

// ----------------------
// Helpers / Middleware
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

// Cache for book API
const cache = new NodeCache({ stdTTL: 60 * 30 }); // 30 min

// ----------------------
// Basic pages
// ----------------------
app.get('/', async (req, res) => {
  try {
    const trending = await pickSomeBooks('trending');
    const philosophy = await pickSomeBooks('philosophy');
    const history = await pickSomeBooks('history');
    return res.render('index', {
      pageTitle: 'BookLantern',
      trending,
      philosophy,
      history
    });
  } catch (e) {
    console.error('Home error:', e);
    return res.render('error', { message: 'Unexpected error' });
  }
});

app.get('/watch', async (req, res) => {
  try {
    // Placeholder list to avoid EJS error; wire to Supabase later.
    const videos = [];
    return res.render('watch', { videos });
  } catch (e) {
    console.error('Watch error:', e);
    return res.render('error', { message: 'Unexpected error' });
  }
});

app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));

// ----------------------
// Auth pages (Supabase)
// ----------------------
app.get('/login', csrfProtection, (req, res) => {
  res.render('login', {
    csrfToken: req.csrfToken(),
    next: req.query.next || '/'
  });
});

app.post('/login', csrfProtection, async (req, res) => {
  const { email, password, next } = req.body;
  try {
    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
    if (error) {
      return res.status(400).render('login', { csrfToken: req.csrfToken(), error: error.message, next: next || '/' });
    }
    const user = data.user;

    // Read role from profiles (or default user)
    let role = 'user';
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('role,name')
      .eq('id', user.id)
      .single();
    if (prof && prof.role) role = prof.role;
    if (!prof) {
      await supabaseAdmin.from('profiles').insert({ id: user.id, email: user.email, role });
    }

    req.session.user = { id: user.id, email: user.email, role };
    return res.redirect(next || '/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).render('login', { csrfToken: req.csrfToken(), error: 'Login failed', next: next || '/' });
  }
});

app.get('/register', csrfProtection, (req, res) => {
  res.render('register', {
    csrfToken: req.csrfToken(),
    next: req.query.next || '/'
  });
});

app.post('/register', csrfProtection, async (req, res) => {
  const { name, email, password, next } = req.body;
  try {
    const { data, error } = await supabaseAnon.auth.signUp({
      email, password,
      options: { data: { name } }
    });
    if (error) {
      return res.status(400).render('register', { csrfToken: req.csrfToken(), error: error.message, next: next || '/' });
    }
    const user = data.user;
    if (!user) {
      return res.render('register', {
        csrfToken: req.csrfToken(),
        success: 'Please check your email to confirm your account.',
        next: next || '/'
      });
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

app.post('/logout', async (req, res) => {
  try {
    req.session = null;
    return res.redirect('/');
  } catch (e) {
    console.error('Logout error:', e);
    return res.redirect('/');
  }
});

// ----------------------
// Account pages
// ----------------------
app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { pageTitle: 'Your Library' });
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.render('admin', { pageTitle: 'Admin' });
});

// ----------------------
// Reader + Book API
// ----------------------
app.get('/read/:provider/:id', requireAuth, (req, res) => {
  const { provider, id } = req.params;
  res.render('read', { provider, id, pageTitle: 'Read - BookLantern' });
});

// Search (multi-source lite)
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

// Proxy images/files (CORS-safe)
app.get('/proxy', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send('Missing url');
    const r = await fetch(url);
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    const buf = await r.buffer();
    return res.send(buf);
  } catch (e) {
    console.error('Proxy error:', e);
    return res.status(500).end();
  }
});

// Unified book fetcher used by the reader
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
// Error / 404
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
// Helpers: category book lists + provider fetchers
// ======================================================
async function pickSomeBooks(kind) {
  // TODO: Replace with real curated multi-source lists.
  const per = 10;
  const gIds = {
    trending: ['64176','58988','58596','56517','26659','10471','7142','6593','14328','42983'],
    philosophy: ['42884','66638','10643','11431','47204','5827','47204','10471','64176','58596'],
    history: ['64176','47204','10471','26659','56517','14328','6593','7142','58988','42983']
  }[kind] || [];

  const items = await Promise.all(
    gIds.slice(0, per).map(async gid => ({
      provider: 'pg',
      id: gid,
      title: `PG #${gid}`,
      author: '',
      cover: `/proxy?url=${encodeURIComponent(`https://www.gutenberg.org/cache/epub/${gid}/pg${gid}.cover.medium.jpg`)}`
    }))
  );
  return items;
}

async function searchAcrossProviders(q) {
  const out = [];

  // Open Library works
  try {
    const r = await fetch(`https://openlibrary.org/search.json?limit=12&q=${encodeURIComponent(q)}`);
    if (r.ok) {
      const j = await r.json();
      (j.docs || []).slice(0, 12).forEach(d => {
        const wid = d.key?.replace('/works/','');
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

  // Project Gutenberg search (via gutendex)
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

async function fetchFromProvider(provider, id) {
  if (provider === 'pg') {
    const base = `https://www.gutenberg.org/files/${id}/${id}-h/${id}-h.htm`;
    const alt1 = `https://www.gutenberg.org/files/${id}/${id}-h/${id}-h.html`;
    const txt = `https://www.gutenberg.org/files/${id}/${id}.txt`;

    const html = await tryFetchText([base, alt1]);
    if (html) {
      return { type: 'html', title: `Project Gutenberg #${id}`, content: html };
    }
    const plain = await tryFetchText([txt]);
    if (plain) return { type: 'text', title: `Project Gutenberg #${id}`, content: plain };
    return { type: 'error', error: 'Not found' };
  }

  if (provider === 'ol') {
    const work = await (await fetch(`https://openlibrary.org/works/${id}.json`)).json();
    const title = work?.title || id;
    const text = `<h1>${title}</h1><p>Open Library work page: <a href="https://openlibrary.org/works/${id}" target="_blank" rel="noopener">openlibrary.org</a></p>`;
    return { type: 'html', title, content: text };
  }

  if (provider === 'ia') {
    const text = `<p>Internet Archive item: ${id}. (Embed/derivative fetch can be added here.)</p>`;
    return { type: 'html', title: `IA ${id}`, content: text };
  }

  return { type: 'error', error: 'Unknown provider' };
}

async function tryFetchText(urls) {
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok) return await r.text();
    } catch {}
  }
  return null;
}
