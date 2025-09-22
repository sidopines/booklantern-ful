/* server.js — UI-only shell with CSP, random shelves, resilient watch */

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const fs = require('fs');

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

/* CSP: allow ALL https images so covers & thumbs load everywhere */
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", "data:", "https:"]
    }
  }
}));

/* safe locals */
app.use((req, res, next) => {
  res.locals.loggedIn = !!(req.user);
  res.locals.user = req.user || null;
  res.locals.buildId = process.env.RENDER_GIT_COMMIT || Date.now().toString();
  res.locals.referrer = req.get('referer') || '/';
  next();
});

/* util: random sample */
function sample(arr = [], n = 10) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/* HOME — shelves with variety from multiple subjects */
app.get('/', async (req, res) => {
  try {
    const key = 'home:shelves:v2.randomized';
    let data = cache.get(key);
    if (!data) {
      const subjects = [
        'classics', 'fiction', 'philosophy', 'history', 'science', 'biography'
      ];
      const urls = subjects.map(s => `https://openlibrary.org/subjects/${s}.json?limit=50`);
      const jsons = await Promise.all(urls.map(u => fetchJsonRetry(u, { tries: 2, timeout: 9000 })));
      const by = {};
      subjects.forEach((s, i) => (by[s] = (jsons[i].works || [])));

      data = {
        // build “Trending” from a mix so it doesn’t feel like one source
        trending: normalizeBooks(sample(
          [...by.classics, ...by.fiction, ...by.science, ...by.biography], 12
        )),
        philosophy: normalizeBooks(sample(by.philosophy, 12)),
        history: normalizeBooks(sample(by.history, 12)),
      };
      cache.set(key, data, 60 * 60 * 1000); // 1h
    }
    res.render('index', data);
  } catch (e) {
    console.error('home shelves failed; using fallback', e.message);
    const sampleList = normalizePlain(fallbackBooks);
    res.render('index', {
      trending: sample(sampleList, 8),
      philosophy: sample(sampleList, 8),
      history: sample(sampleList, 8)
    });
  }
});

/* READ — search */
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

/* WATCH — YOUR videos first (data/videos.json), then fallback */
app.get('/watch', async (req, res) => {
  try {
    let videos = null;

    // 1) your curated file (create data/videos.json anytime)
    const customPath = path.join(__dirname, 'data', 'videos.json');
    if (fs.existsSync(customPath)) {
      try { videos = JSON.parse(fs.readFileSync(customPath, 'utf8')); }
      catch (e) { console.warn('videos.json parse error', e.message); }
    }

    // 2) if none present, optional DB hook (left disabled but safe)
    // if (!videos && global.Video && typeof Video.find === 'function') {
    //   const rows = await Video.find({ published: { $ne: false } }).sort({ createdAt: -1 }).limit(24).lean();
    //   videos = (rows || []).map(v => ({ title: v.title, thumbnail: v.thumbnail, href: v.url }));
    // }

    // 3) fallback list
    if (!videos || !Array.isArray(videos) || videos.length === 0) {
      videos = fallbackVideos;
    }

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
