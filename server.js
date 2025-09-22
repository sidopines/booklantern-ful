/* server.js — UI + resilient data + admin for videos */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const fs = require('fs');
const mongoose = require('mongoose');

const fetchJsonRetry = require('./lib/fetchJsonRetry');
const normalizeBooks = require('./lib/normalizeBooks');
const normalizePlain = require('./lib/normalizeBooks').fromPlain;
const cache = require('./lib/cache');
const fallbackBooks = require('./data/fallbackBooks.json');
const fallbackVideos = require('./data/fallbackVideos.json');
let Video = null;
try { Video = require('./models/Video'); } catch { /* first run before model exists */ }

const app = express();
const PORT = process.env.PORT || 10000;

/* view + static */
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

/* parse forms for admin */
app.use(express.urlencoded({ extended: true }));

/* CSP: let images & iframes load from the web */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "https:"],
      "frame-src": ["https:", "data:"],     // allow YouTube/Vimeo embeds
      "media-src": ["https:", "data:"],     // audio if needed
    }
  }
}));

/* locals (assuming some auth middleware sets req.user; if not, all pages still work) */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.loggedIn = !!req.user;
  const email = (req.user && (req.user.email || req.user.username)) ? String(req.user.email || req.user.username).toLowerCase() : '';
  res.locals.isAdmin = email && ADMIN_EMAILS.includes(email);
  res.locals.buildId = process.env.RENDER_GIT_COMMIT || Date.now().toString();
  res.locals.referrer = req.get('referer') || '/';
  next();
});

/* util */
function sample(arr = [], n = 10) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

/* HOME */
app.get('/', async (req, res) => {
  try {
    const key = 'home:shelves:v3';
    let data = cache.get(key);
    if (!data) {
      const subjects = ['classics', 'fiction', 'philosophy', 'history', 'science', 'biography'];
      const urls = subjects.map(s => `https://openlibrary.org/subjects/${s}.json?limit=60`);
      const jsons = await Promise.all(urls.map(u => fetchJsonRetry(u, { tries: 2, timeout: 9000 })));
      const by = {};
      subjects.forEach((s, i) => (by[s] = (jsons[i].works || [])));

      data = {
        trending: normalizeBooks(sample([...by.classics, ...by.fiction, ...by.science, ...by.biography], 12)),
        philosophy: normalizeBooks(sample(by.philosophy, 12)),
        history: normalizeBooks(sample(by.history, 12)),
      };
      cache.set(key, data, 60 * 60 * 1000);
    }
    res.render('index', data);
  } catch (e) {
    console.error('home shelves failed; using fallback', e.message);
    const all = normalizePlain(fallbackBooks);
    res.render('index', {
      trending: sample(all, 12), philosophy: sample(all, 12), history: sample(all, 12)
    });
  }
});

/* READ (search) */
app.get('/read', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.render('read', { items: [] });
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=24`;
  try {
    const json = await fetchJsonRetry(url, { tries: 2, timeout: 9000 });
    const items = normalizeBooks(json.docs || []);
    if (items.length) return res.render('read', { items });
    const lower = q.toLowerCase();
    const local = normalizePlain(fallbackBooks)
      .filter(x => (x.title || '').toLowerCase().includes(lower) || (x.author || '').toLowerCase().includes(lower));
    res.render('read', { items: local });
  } catch (e) {
    console.error('read search failed; using fallback', e.message);
    const lower = q.toLowerCase();
    const local = normalizePlain(fallbackBooks)
      .filter(x => (x.title || '').toLowerCase().includes(lower) || (x.author || '').toLowerCase().includes(lower));
    res.render('read', { items: local });
  }
});

/* WATCH — Durable: DB → data/videos.json → fallback */
app.get('/watch', async (req, res) => {
  try {
    let videos = [];

    // 1) Mongo (admin catalog)
    const dbReady = mongoose.connection && mongoose.connection.readyState === 1;
    if (Video && dbReady) {
      const rows = await Video.find({ $or: [{ published: { $exists: false } }, { published: true }] })
        .sort({ createdAt: -1 }).limit(48).lean();
      videos = (rows || []).map(v => ({
        title: v.title || 'Untitled',
        thumbnail: v.thumbnail || '',
        href: v.href || '#'
      }));
    }

    // 2) Optional repo file (works even without DB)
    if (!videos || videos.length === 0) {
      const customPath = path.join(__dirname, 'data', 'videos.json');
      if (fs.existsSync(customPath)) {
        try {
          const raw = fs.readFileSync(customPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length) videos = parsed;
        } catch (e) { console.warn('videos.json parse error:', e.message); }
      }
    }

    // 3) Fallback
    if (!videos || videos.length === 0) videos = fallbackVideos;

    res.render('watch', { videos });
  } catch (e) {
    console.error('watch route error', e);
    res.render('watch', { videos: fallbackVideos });
  }
});

/* ADMIN — tiny panel to manage videos (email allowlist via ADMIN_EMAILS) */
function guardAdmin(req, res, next) {
  if (res.locals.isAdmin) return next();
  return res.status(403).send('Forbidden (admin only)');
}

app.get('/admin/videos', guardAdmin, async (req, res) => {
  const rows = (Video && mongoose.connection.readyState === 1)
    ? await Video.find({}).sort({ createdAt: -1 }).lean()
    : [];
  res.render('admin/videos', { rows });
});

app.post('/admin/videos/create', guardAdmin, async (req, res) => {
  try {
    if (!(Video && mongoose.connection.readyState === 1)) throw new Error('DB not ready');
    const { title, href, thumbnail } = req.body;
    if (!title || !href) throw new Error('Title and URL are required');
    await Video.create({ title, href, thumbnail, published: true });
    return res.redirect('/admin/videos');
  } catch (e) {
    console.error('create video failed', e);
    return res.status(400).send('Create failed: ' + e.message);
  }
});

app.post('/admin/videos/:id/delete', guardAdmin, async (req, res) => {
  try {
    if (!(Video && mongoose.connection.readyState === 1)) throw new Error('DB not ready');
    await Video.findByIdAndDelete(req.params.id);
    return res.redirect('/admin/videos');
  } catch (e) {
    console.error('delete video failed', e);
    return res.status(400).send('Delete failed: ' + e.message);
  }
});

/* simple pages */
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

/* health */
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
