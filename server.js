// server.js — Supabase + multi-source reader (OL + IA + PG)
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

// Cache for book API + lists
const cache = new NodeCache({ stdTTL: 60 * 30 }); // 30 min

// ----------------------
// Basic pages
// ----------------------
app.get('/', async (req, res) => {
  try {
    // three rows using Open Library subjects (broad + neutral)
    const [trending, philosophy, history] = await Promise.all([
      listFromOpenLibrarySubject('fiction', 10),
      listFromOpenLibrarySubject('philosophy', 10),
      listFromOpenLibrarySubject('history', 10),
    ]);

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

app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));

// ----------------------
// WATCH (safe stub so template never 500s)
// ----------------------
app.get('/watch', (req, res) => {
  // you can feed this from Supabase later
  res.render('watch', { videos: [] });
});

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

// SEARCH (multi-source)
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

// Cover / file proxy (to avoid CORS & mixed content)
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

// Reader data
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
// Lists + Search (Open Library + Internet Archive + Gutenberg)
// ======================================================

async function listFromOpenLibrarySubject(subject, limit = 10) {
  const key = `ol:subj:${subject}:${limit}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const r = await fetch(`https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limit}`);
    if (!r.ok) throw new Error('OL subject failed');
    const j = await r.json();
    const out = (j.works || []).slice(0, limit).map(w => {
      const cover = w.cover_id
        ? `/proxy?url=${encodeURIComponent(`https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg`)}`
        : null;
      return {
        provider: 'ol',
        id: w.key.replace('/works/',''),
        title: w.title || 'Untitled',
        author: (w.authors && w.authors[0] && w.authors[0].name) || '',
        cover
      };
    });
    cache.set(key, out);
    return out;
  } catch {
    return [];
  }
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
          cover: d.cover_i ? `/proxy?url=${encodeURIComponent(`https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`)}`
                           : null
        });
      });
    }
  } catch {}

  // Internet Archive (texts with epub or pdf)
  try {
    const query = `(${q}) AND mediatype:texts`;
    const url = `https://archive.org/advancedsearch.php?output=json&q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=12`;
    const r = await fetch(url);
    if (r.ok) {
      const j = await r.json();
      (j.response?.docs || []).forEach(d => {
        out.push({
          provider: 'ia',
          id: d.identifier,
          title: d.title || d.identifier,
          author: (Array.isArray(d.creator) ? d.creator[0] : d.creator) || '',
          cover: `/proxy?url=${encodeURIComponent(`https://archive.org/services/img/${d.identifier}`)}`
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
          cover: b.formats?.['image/jpeg'] ? `/proxy?url=${encodeURIComponent(b.formats['image/jpeg'])}` : null
        });
      });
    }
  } catch {}

  return out;
}

// ======================================================
// Provider fetchers for the reader
// ======================================================
async function fetchFromProvider(provider, id) {
  if (provider === 'pg') {
    // Prefer EPUB from Gutenberg (via Gutendex)
    try {
      const r = await fetch(`https://gutendex.com/books/${id}`);
      if (r.ok) {
        const b = await r.json();
        const title  = b.title || `Project Gutenberg #${id}`;
        const author = (b.authors && b.authors[0] && b.authors[0].name) || '';
        const epub   = b.formats?.['application/epub+zip'];
        const html   = b.formats?.['text/html'] || b.formats?.['text/html; charset=utf-8'];
        const txt    = b.formats?.['text/plain; charset=utf-8'] || b.formats?.['text/plain'];

        if (epub) {
          return { type: 'epub', title, author, epubUrl: `/proxy?url=${encodeURIComponent(epub)}` };
        }
        if (html) {
          const page = await (await fetch(html)).text();
          return { type: 'html', title, author, content: page };
        }
        if (txt) {
          const page = await (await fetch(txt)).text();
          return { type: 'text', title, author, content: page };
        }
      }
    } catch {}
    return { type: 'error', error: 'Not found' };
  }

  if (provider === 'ia') {
    // Internet Archive metadata → find an .epub file
    try {
      const meta = await (await fetch(`https://archive.org/metadata/${id}`)).json();
      const files = meta?.files || [];
      const epub = files.find(f => /\.epub$/i.test(f.name));
      const pdf  = files.find(f => /\.pdf$/i.test(f.name));
      const title = meta?.metadata?.title || id;
      const author = meta?.metadata?.creator || '';

      if (epub) {
        const url = `https://archive.org/download/${id}/${encodeURIComponent(epub.name)}`;
        return { type: 'epub', title, author, epubUrl: `/proxy?url=${encodeURIComponent(url)}` };
      }
      if (pdf) {
        const url = `https://archive.org/download/${id}/${encodeURIComponent(pdf.name)}`;
        const html = `<iframe src="${url}" style="width:100%;height:80vh;border:0;"></iframe>`;
        return { type: 'html', title, author, content: html };
      }
      // fallback: link out
      const html = `<p>Open at Internet Archive: <a href="https://archive.org/details/${id}" target="_blank" rel="noopener">archive.org/details/${id}</a></p>`;
      return { type: 'html', title, author, content: html };
    } catch {
      return { type: 'error', error: 'Not found' };
    }
  }

  if (provider === 'ol') {
    // Try to resolve an IA edition (ocaid) to get an EPUB; else a nice landing
    try {
      const work = await (await fetch(`https://openlibrary.org/works/${id}.json`)).json().catch(() => null);
      const title = work?.title || id;
      let author = '';
      if (work?.authors && work.authors[0]?.author?.key) {
        const a = await (await fetch(`https://openlibrary.org${work.authors[0].author.key}.json`)).json().catch(() => null);
        author = a?.name || '';
      }

      // Find an edition with IA id (ocaid)
      const ed = await (await fetch(`https://openlibrary.org/works/${id}/editions.json?limit=50`)).json().catch(() => null);
      const withOcaid = (ed?.entries || []).find(e => e.ocaid);
      if (withOcaid) {
        const ia = withOcaid.ocaid;
        const meta = await (await fetch(`https://archive.org/metadata/${ia}`)).json().catch(() => null);
        const files = meta?.files || [];
        const epub = files.find(f => /\.epub$/i.test(f.name));
        if (epub) {
          const url = `https://archive.org/download/${ia}/${encodeURIComponent(epub.name)}`;
          return { type: 'epub', title, author, epubUrl: `/proxy?url=${encodeURIComponent(url)}` };
        }
        const pdf = files.find(f => /\.pdf$/i.test(f.name));
        if (pdf) {
          const url = `https://archive.org/download/${ia}/${encodeURIComponent(pdf.name)}`;
          const html = `<iframe src="${url}" style="width:100%;height:80vh;border:0;"></iframe>`;
          return { type: 'html', title, author, content: html };
        }
      }

      const html = `<h1>${escapeHtml(title)}</h1>
        <p>${author ? escapeHtml(author) : ''}</p>
        <p>Open Library work page: <a href="https://openlibrary.org/works/${id}" target="_blank" rel="noopener">openlibrary.org</a></p>`;
      return { type: 'html', title, author, content: html };
    } catch {
      return { type: 'error', error: 'Not found' };
    }
  }

  return { type: 'error', error: 'Unknown provider' };
}

// ----------------------
// Small util
// ----------------------
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
