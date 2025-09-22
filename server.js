/* server.js — minimal app shell with CSP + shelves/search + watch fallback */

const express = require('express');
const path = require('path');
const helmet = require('helmet');

const fetchJsonRetry = require('./lib/fetchJsonRetry');
const normalizeBooks = require('./lib/normalizeBooks');
const normalizePlain = require('./lib/normalizeBooks').fromPlain;
const cache = require('./lib/cache');
const fallbackBooks = require('./data/fallbackBooks.json');
const fallbackVideos = require('./data/fallbackVideos.json');

const app = express();
const PORT = process.env.PORT || 10000;

/* views + static */
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

/* CSP: allow OL covers + data: */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "https://covers.openlibrary.org"],
    }
  }
}));

/* safe locals */
app.use((req, res, next) => {
  res.locals.loggedIn = !!(req.user);
  res.locals.user = req.user || null;
  res.locals.buildId = process.env.RENDER_GIT_COMMIT || Date.now().toString();
  next();
});

/* back-link helper in locals (optional) */
app.use((req, res, next) => {
  res.locals.referrer = req.get('referer') || '/';
  next();
});

/* HOME — shelves */
app.get('/', async (req, res) => {
  try {
    const key = 'home:shelves:v1.3';
    let data = cache.get(key);
    if (!data) {
      const urls = [
        'https://openlibrary.org/subjects/classics.json?limit=12',
        'https://openlibrary.org/subjects/philosophy.json?limit=12',
        'https://openlibrary.org/subjects/history.json?limit=12'
      ];
      const [classics, philosophy, history] = await Promise.all(
        urls.map(u => fetchJsonRetry(u, { tries: 2, timeout: 8500 }))
      );
      data = {
        trending: normalizeBooks((classics.works || []).slice(0, 10)),
        philosophy: normalizeBooks((philosophy.works || []).slice(0, 10)),
        history: normalizeBooks((history.works || []).slice(0, 10)),
      };
      cache.set(key, data, 60 * 60 * 1000);
    }
    res.render('index', data);
  } catch (e) {
    console.error('home shelves failed; using fallback', e.message);
    const sample = normalizePlain(fallbackBooks);
    res.render('index', {
      trending: sample.slice(0, 6),
      philosophy: sample.slice(6, 10),
      history: sample.slice(10, 12)
    });
  }
});

/* READ — search */
app.get('/read', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.render('read', { items: [] });

  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=24`;
  try {
    const json = await fetchJsonRetry(url, { tries: 2, timeout: 8500 });
    const items = normalizeBooks(json.docs || []);
    if (items.length) return res.render('read', { items });

    // fall back to local sample search
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

/* WATCH — DB/route data if present → else fallback */
app.get('/watch', async (req, res) => {
  try {
    let videos = res.locals.videos || req.videos || null;

    // If you have a Video model, you can enable this block safely:
    // if (!videos && global.Video && typeof Video.find === 'function') {
    //   videos = await Video.find({ published: { $ne: false } }).sort({ createdAt: -1 }).limit(24).lean();
    //   videos = (videos || []).map(v => ({
    //     title: v.title || 'Untitled',
    //     thumbnail: v.thumbnail || v.thumb || null,
    //     href: v.url || v.href || '#'
    //   }));
    // }

    if (!videos || !videos.length) videos = fallbackVideos;
    res.render('watch', { videos });
  } catch (e) {
    console.error('watch route error', e);
    res.render('watch', { videos: fallbackVideos });
  }
});

/* simple pages */
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

/* debug & health */
app.get('/debug/covers', (req, res) => {
  res.render('read', { items: normalizePlain(fallbackBooks) });
});
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
