// server.js — full & final

import express from 'express';
import path from 'path';
import crypto from 'crypto';
import fetch from 'node-fetch';          // if Node 20 global fetch is ok, you can remove this import & package
import session from 'express-session';
import MongoStorePkg from 'connect-mongo';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import compression from 'compression';
import helmet from 'helmet';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.resolve();
const app = express();
const cache = new NodeCache({ stdTTL: 3600, useClones: false }); // 1h

// ---------- Express setup ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: false, // we'll allow iframe/proxy; you can tighten later
}));
app.use(compression());
app.use(morgan('tiny'));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// ---------- Sessions (Mongo or Memory) ----------
const MongoStore = MongoStorePkg.create;
let sessionStore;
if (process.env.MONGODB_URI) {
  sessionStore = MongoStore({ mongoUrl: process.env.MONGODB_URI });
  console.log('🗄️  Session store: MongoStore');
} else {
  console.warn('⚠️  No MONGODB_URI set, using MemoryStore (dev only)');
}

app.use(session({
  name: 'booklantern.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-' + crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!process.env.RENDER,      // secure cookies on Render
    maxAge: 1000 * 60 * 60 * 24 * 7,   // 7 days
  }
}));

// expose minimal auth state to views
app.use((req, res, next) => {
  res.locals.buildId = process.env.BUILD_ID || 'dev';
  res.locals.loggedIn = !!req.session.user;
  next();
});

// ---------- Auth stubs (keep your real ones if you have) ----------
function requireAuth(req, res, next) {
  if (!req.session.user) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  next();
}

app.get('/login', (req, res) => {
  res.render('login', { messages: {} });
});
app.post('/login', (req, res) => {
  // TODO: replace with real check
  const { email } = req.body;
  if (email) {
    req.session.user = { email };
    return res.redirect(req.query.next || '/');
  }
  res.render('login', { messages: { error: 'Please enter an email' }});
});
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- Multi-source aggregation ----------
function initials(title = '') {
  const t = title.trim();
  if (!t) return 'BK';
  const parts = t.split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join('').toUpperCase();
}

function normItem({ id, provider, title, author, cover }) {
  return {
    id, provider,
    title: title || 'Untitled',
    author: author || '',
    cover: cover || '',
    initials: initials(title || author),
  };
}

// Open Library sample queries
async function olSearch(q) {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12`;
  const r = await fetch(url);
  const j = await r.json();
  return (j.docs || []).map(d => {
    const cover = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '';
    return normItem({
      id: d.key?.replace('/works/', '') || d.cover_edition_key || d.key || String(d.cover_i || ''),
      provider: 'ol',
      title: d.title,
      author: (d.author_name && d.author_name[0]) || '',
      cover
    });
  });
}

// Project Gutenberg (Gutenberg API via gutendex)
async function pgSearch(q) {
  const url = `https://gutendex.com/books/?search=${encodeURIComponent(q)}&page=1`;
  const r = await fetch(url);
  const j = await r.json();
  return (j.results || []).slice(0, 12).map(b => {
    const img = b.formats && (b.formats['image/jpeg'] || b.formats['image/png']) || '';
    return normItem({
      id: String(b.id),
      provider: 'pg',
      title: b.title,
      author: (b.authors && b.authors[0] && b.authors[0].name) || '',
      cover: img
    });
  });
}

// Standard Ebooks (simple feed)
async function seRecent() {
  const url = 'https://standardebooks.org/opds/index.json';
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  // The feed is large; take a few from entries if present
  const entries = j?.navigation || [];
  // Fallback: return empty
  return entries.slice(0, 12).map((e, idx) =>
    normItem({
      id: e.url || String(idx),
      provider: 'se',
      title: e.title || 'Standard Ebook',
      author: '',
      cover: '' // Standard Ebooks provides covers per book page; leave placeholder
    })
  );
}

// Smart combine: ensure some variety
async function multiShelves() {
  const cached = cache.get('home-shelves');
  if (cached) return cached;

  // Three shelves: pick different queries
  const [olTrend, pgTrend] = await Promise.all([
    olSearch('classics'),
    pgSearch('classic')
  ]);
  const trending = [...olTrend.slice(0, 8), ...pgTrend.slice(0, 4)];

  const [olPhil, pgPhil] = await Promise.all([
    olSearch('philosophy'),
    pgSearch('philosophy')
  ]);
  const philosophy = [...olPhil.slice(0, 8), ...pgPhil.slice(0, 4)];

  const [olHist, pgHist] = await Promise.all([
    olSearch('history'),
    pgSearch('history')
  ]);
  const history = [...olHist.slice(0, 8), ...pgHist.slice(0, 4)];

  const shelves = { trending, philosophy, history };
  cache.set('home-shelves', shelves);
  return shelves;
}

app.get('/', async (req, res, next) => {
  try {
    const { trending, philosophy, history } = await multiShelves();
    res.render('index', { trending, philosophy, history, buildId: process.env.BUILD_ID || 'dev' });
  } catch (e) { next(e); }
});

// Reader: login-gated
app.get('/read/:provider/:id', requireAuth, async (req, res, next) => {
  try {
    const { provider, id } = req.params;
    let readerUrl = '';
    let book = { provider, id, title: 'Untitled' };

    if (provider === 'ol') {
      // Try OL work/edition → IA page
      // Render the IA readable page; we’ll proxy through /proxy.
      // Many OL items map to archive.org details pages.
      readerUrl = `https://openlibrary.org/works/${encodeURIComponent(id)}`;
    } else if (provider === 'pg') {
      // Gutendex → plain HTML
      readerUrl = `https://www.gutenberg.org/ebooks/${encodeURIComponent(id)}/html`;
    } else if (provider === 'se') {
      // Standard Ebooks: link is a catalog; often the webpage has direct html/epub
      readerUrl = `https://standardebooks.org/ebooks/${encodeURIComponent(id)}`;
    } else {
      // Unknown provider → bail gracefully
      return res.status(404).render('404', { pageTitle: 'Not found', pageDescription: '' });
    }

    res.render('read', { book, readerUrl, buildId: process.env.BUILD_ID || 'dev' });
  } catch (e) { next(e); }
});

// Simple proxy to keep user on our domain inside the iframe
app.get('/proxy', async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).send('Missing URL');
    const upstream = await fetch(u, { redirect: 'follow' });
    // Copy basic headers
    res.set('Content-Type', upstream.headers.get('content-type') || 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600'); // 10 min
    upstream.body.pipe(res);
  } catch (e) {
    res.status(502).send('Upstream unavailable');
  }
});

// Simple /read search passthrough to homepage style (optional)
app.get('/read', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.redirect('/');

    const [ol, pg] = await Promise.all([olSearch(q), pgSearch(q)]);
    const results = [...ol, ...pg].slice(0, 36);
    res.render('read', {
      book: { title: `Results for "${q}"` },
      readerUrl: 'about:blank'  // no iframe; you can add a grid view here if you want
    });
  } catch (e) { next(e); }
});

// Footer pages (About/Contact) – keep your existing ones if you already have
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));

// Errors & 404
app.use((req, res) => res.status(404).render('404', { pageTitle: 'Not found', pageDescription: '' }));
app.use((err, req, res, _next) => {
  console.error('🔥 Error:', err);
  res.status(500).render('error', { pageTitle: 'Something went wrong', err });
});

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
