// server.js — Supabase + PWA + Offline queue endpoints + multi-source search
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

// Cache for book API & homepage
const cache = new NodeCache({ stdTTL: 60 * 30 }); // 30 min

// ----------------------
// Basic pages
// ----------------------
app.get('/', async (req, res) => {
  try {
    // pull curated sets with proper metadata (title/author/covers)
    const trending = await curatedSet('trending');
    const philosophy = await curatedSet('philosophy');
    const history = await curatedSet('history');
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

// Search (multi-source)
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
// Library actions (Save / Notes) with offline-friendly behavior
// ----------------------
app.post('/api/save', requireAuth, async (req, res) => {
  try {
    const { provider, id, title, author, cover } = req.body;
    if (!provider || !id) return res.status(400).json({ error: 'Missing provider or id' });
    const user_id = req.session.user.id;

    // upsert into "saves" (unique: user_id+provider+id)
    const { error } = await supabaseAdmin
      .from('saves')
      .upsert({ user_id, provider, book_id: String(id), title: title || null, author: author || null, cover: cover || null }, {
        onConflict: 'user_id,provider,book_id'
      });

    if (error) {
      console.error('save error', error);
      return res.status(500).json({ error: 'Failed to save' });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('save api error', e);
    return res.status(500).json({ error: 'Failed to save' });
  }
});

app.get('/api/notes', requireAuth, async (req, res) => {
  try {
    const { provider, id } = req.query;
    if (!provider || !id) return res.status(400).json({ error: 'Missing provider or id' });
    const user_id = req.session.user.id;

    const { data, error } = await supabaseAdmin
      .from('notes')
      .select('id, provider, book_id, text, pos, created_at')
      .eq('user_id', user_id)
      .eq('provider', provider)
      .eq('book_id', String(id))
      .order('created_at', { ascending: false });

    if (error) {
      console.error('notes get error', error);
      return res.status(500).json({ error: 'Failed to fetch notes' });
    }
    return res.json({ notes: data || [] });
  } catch (e) {
    console.error('notes api error', e);
    return res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

app.post('/api/notes', requireAuth, async (req, res) => {
  try {
    const { provider, id, text, pos } = req.body;
    if (!provider || !id || !text) return res.status(400).json({ error: 'Missing fields' });
    const user_id = req.session.user.id;

    const { error } = await supabaseAdmin
      .from('notes')
      .insert({ user_id, provider, book_id: String(id), text, pos: pos || null });

    if (error) {
      console.error('notes insert error', error);
      return res.status(500).json({ error: 'Failed to add note' });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('notes api error', e);
    return res.status(500).json({ error: 'Failed to add note' });
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
// Helpers: curated homepage + search + provider fetchers
// ======================================================

// Curated IDs (mixed providers). We’ll look up real metadata.
const CURATED = {
  trending: [
    { provider: 'pg', id: '10471' },
    { provider: 'pg', id: '64176' },
    { provider: 'ol', id: 'OL17732W' },
    { provider: 'ia', id: 'bub_gb_5XoWAAAAYAAJ' }, // IA id example
    { provider: 'se', id: 'the-iliad-homer' }      // Standard Ebooks slug example
  ],
  philosophy: [
    { provider: 'pg', id: '42884' },
    { provider: 'pg', id: '66638' },
    { provider: 'se', id: 'meditations-marcus-aurelius' },
    { provider: 'ol', id: 'OL8193416W' }
  ],
  history: [
    { provider: 'pg', id: '26659' },
    { provider: 'pg', id: '58988' },
    { provider: 'ia', id: 'historyofgreece01groo' },
    { provider: 'se', id: 'a-short-history-of-england-g-k-chesterton' }
  ]
};

async function curatedSet(kind) {
  const items = CURATED[kind] || [];
  const enriched = await Promise.all(items.map(metaLookup));
  return enriched.filter(Boolean);
}

async function metaLookup(item) {
  try {
    const { provider, id } = item;
    if (provider === 'pg') {
      // Gutendex for richer metadata
      const r = await fetch(`https://gutendex.com/books/${id}`);
      if (r.ok) {
        const j = await r.json();
        return {
          provider, id: String(j.id),
          title: j.title || `PG #${id}`,
          author: (j.authors && j.authors[0] && j.authors[0].name) || '',
          cover: j.formats && j.formats['image/jpeg'] ? `/proxy?url=${encodeURIComponent(j.formats['image/jpeg'])}` :
                 `/proxy?url=${encodeURIComponent(`https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`)}`
        };
      }
    }
    if (provider === 'ol') {
      const r = await fetch(`https://openlibrary.org/works/${id}.json`);
      if (r.ok) {
        const j = await r.json();
        const coverId = (j.covers && j.covers[0]) || null;
        return {
          provider, id,
          title: j.title || id,
          author: Array.isArray(j.authors) ? '' : '',
          cover: coverId ? `/proxy?url=${encodeURIComponent(`https://covers.openlibrary.org/b/id/${coverId}-M.jpg`)}` : null
        };
      }
    }
    if (provider === 'ia') {
      // IA metadata
      const r = await fetch(`https://archive.org/metadata/${id}`);
      if (r.ok) {
        const j = await r.json();
        const title = j.metadata && (j.metadata.title || j.metadata['title']) || id;
        const author = j.metadata && (j.metadata.creator || j.metadata['creator'] || '');
        // Try IA cover if present
        const cover = `/proxy?url=${encodeURIComponent(`https://archive.org/services/img/${id}`)}`;
        return { provider, id, title, author, cover };
      }
    }
    if (provider === 'se') {
      // Standard Ebooks: static metadata fetch from OPDS entry (HTML page fallback)
      // We’ll guess nice title from slug; cover via CDN pattern
      const pretty = id.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' ');
      const cover = `/proxy?url=${encodeURIComponent(`https://standardebooks.org/covers/${id}.png`)}`;
      return { provider, id, title: pretty, author: '', cover };
    }
  } catch (e) {
    console.warn('meta lookup failed', item, e.message);
  }
  // Fallback minimal
  return {
    provider: item.provider, id: item.id,
    title: `${item.provider.toUpperCase()} #${item.id}`,
    author: '', cover: null
  };
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

  // Project Gutenberg (Gutendex)
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

  // Internet Archive (text & ebooks)
  try {
    const qIA = `${q} AND mediatype:(texts)`;
    const r = await fetch(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(qIA)}&output=json&rows=12&fields=identifier,title,creator`);
    if (r.ok) {
      const j = await r.json();
      (j.response && j.response.docs || []).forEach(d => {
        out.push({
          provider: 'ia',
          id: d.identifier,
          title: d.title || d.identifier,
          author: d.creator || '',
          cover: `/proxy?url=${encodeURIComponent(`https://archive.org/services/img/${d.identifier}`)}`
        });
      });
    }
  } catch {}

  // Standard Ebooks (lightweight heuristic search: try direct slug if user typed exact title)
  // We add one "sluggy" guess to widen provider diversity
  const slugGuess = q.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  out.push({ provider: 'se', id: slugGuess, title: q, author: '', cover: `/proxy?url=${encodeURIComponent(`https://standardebooks.org/covers/${slugGuess}.png`)}` });

  return out;
}

async function fetchFromProvider(provider, id) {
  // Return { type: 'html'|'text'|'pdf'|'epub', title, content|url }
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
    const text = `<h1>${title}</h1><p>This Open Library work links to multiple editions. Pick an edition in your library.</p>`;
    return { type: 'html', title, content: text };
  }

  if (provider === 'ia') {
    // Try to embed a readable format if available (PDF/EPUB)
    try {
      const meta = await (await fetch(`https://archive.org/metadata/${id}`)).json();
      const files = meta.files || [];
      const pdf = files.find(f => /\.pdf$/i.test(f.name));
      const epub = files.find(f => /\.epub$/i.test(f.name));
      if (pdf) return { type: 'pdf', title: meta.metadata?.title || id, url: `https://archive.org/download/${id}/${pdf.name}` };
      if (epub) return { type: 'epub', title: meta.metadata?.title || id, url: `https://archive.org/download/${id}/${epub.name}` };
      // fallback message
      const title = meta.metadata?.title || id;
      const html = `<h1>${title}</h1><p>This Internet Archive item may require viewing formats (PDF/EPUB). We’ll add inline rendering where possible.</p>`;
      return { type: 'html', title, content: html };
    } catch {}
    return { type: 'error', error: 'Not found' };
  }

  if (provider === 'se') {
    // Standard Ebooks: serve HTML if available; otherwise link
    const pretty = id.split('-').map(s => s[0]?.toUpperCase() + s.slice(1)).join(' ');
    const html = `<h1>${pretty}</h1><p>Standard Ebooks edition. We’ll fetch and inline the HTML/EPUB in the next pass.</p>`;
    return { type: 'html', title: pretty, content: html };
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
