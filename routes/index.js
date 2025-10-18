// routes/index.js — FINAL (homepage shelves from curated_books, watch page from videos+genres)
const express = require('express');
const router = express.Router();

/* -------------------------------
   Supabase server client (service role)
--------------------------------- */
let supabase = null;
try {
  supabase = require('../supabaseAdmin'); // exports client or null
} catch {
  supabase = null;
}

/* ----------------------------------
   Fallback shelves (same as before)
----------------------------------- */
const FALLBACK = {
  trending: [
    { id: 'ol-origin-darwin', provider: 'openlibrary', title: 'On the Origin of Species', author: 'Charles Darwin',
      cover: 'https://covers.openlibrary.org/b/olid/OL25442902M-L.jpg',
      href: '/read?provider=openlibrary&id=OL25442902M', subjects: ['Science','Biology'] },
    { id: 'pg-relativity', provider: 'gutenberg', title: 'Relativity: The Special and General Theory', author: 'Albert Einstein',
      cover: 'https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=30155', subjects: ['Science','Physics'] },
    { id: 'ol-benfranklin-autobio', provider: 'openlibrary', title: 'The Autobiography of Benjamin Franklin', author: 'Benjamin Franklin',
      cover: 'https://covers.openlibrary.org/b/olid/OL24374150M-L.jpg',
      href: '/read?provider=openlibrary&id=OL24374150M', subjects: ['Biography','History'] },
    { id: 'pg-plato-republic', provider: 'gutenberg', title: 'The Republic', author: 'Plato',
      cover: 'https://www.gutenberg.org/cache/epub/1497/pg1497.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=1497', subjects: ['Philosophy'] },
    { id: 'ol-opticks-newton', provider: 'openlibrary', title: 'Opticks', author: 'Isaac Newton',
      cover: 'https://covers.openlibrary.org/b/olid/OL24263840M-L.jpg',
      href: '/read?provider=openlibrary&id=OL24263840M', subjects: ['Science','Physics'] },
    { id: 'pg-gulliver', provider: 'gutenberg', title: 'Gulliver’s Travels', author: 'Jonathan Swift',
      cover: 'https://www.gutenberg.org/cache/epub/829/pg829.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=829', subjects: ['Fiction','Satire'] },
    { id: 'ol-prince-machiavelli', provider: 'openlibrary', title: 'The Prince', author: 'Niccolò Machiavelli',
      cover: 'https://covers.openlibrary.org/b/olid/OL27665455M-L.jpg',
      href: '/read?provider=openlibrary&id=OL27665455M', subjects: ['Politics','History'] },
    { id: 'pg-art-of-war', provider: 'gutenberg', title: 'The Art of War', author: 'Sun Tzu',
      cover: 'https://www.gutenberg.org/cache/epub/132/pg132.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=132', subjects: ['Strategy','History'] },
  ],
  philosophy: [
    { id: 'pg-ethics', provider: 'gutenberg', title: 'Ethics', author: 'Benedict de Spinoza',
      cover: 'https://www.gutenberg.org/cache/epub/3800/pg3800.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=3800', subjects: ['Philosophy'] },
    { id: 'pg-zarathustra', provider: 'gutenberg', title: 'Thus Spoke Zarathustra', author: 'Friedrich Nietzsche',
      cover: 'https://www.gutenberg.org/cache/epub/1998/pg1998.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=1998', subjects: ['Philosophy'] },
    { id: 'pg-utilitarianism', provider: 'gutenberg', title: 'Utilitarianism', author: 'John Stuart Mill',
      cover: 'https://www.gutenberg.org/cache/epub/11224/pg11224.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=11224', subjects: ['Philosophy'] },
    { id: 'pg-meditations', provider: 'gutenberg', title: 'Meditations', author: 'Marcus Aurelius',
      cover: 'https://www.gutenberg.org/cache/epub/2680/pg2680.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=2680', subjects: ['Philosophy','Stoicism'] },
    { id: 'pg-republic', provider: 'gutenberg', title: 'The Republic', author: 'Plato',
      cover: 'https://www.gutenberg.org/cache/epub/1497/pg1497.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=1497', subjects: ['Philosophy'] },
  ],
  history: [
    { id: 'pg-history-herodotus', provider: 'gutenberg', title: 'The Histories', author: 'Herodotus',
      cover: 'https://www.gutenberg.org/cache/epub/2707/pg2707.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=2707', subjects: ['History'] },
    { id: 'ol-souls-black-folk', provider: 'openlibrary', title: 'The Souls of Black Folk', author: 'W. E. B. Du Bois',
      cover: 'https://covers.openlibrary.org/b/olid/OL24378309M-L.jpg',
      href: '/read?provider=openlibrary&id=OL24378309M', subjects: ['History','Sociology'] },
    { id: 'pg-decline-fall', provider: 'gutenberg', title: 'The History of the Decline and Fall of the Roman Empire (Vol. 1)', author: 'Edward Gibbon',
      cover: 'https://www.gutenberg.org/cache/epub/731/pg731.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=731', subjects: ['History'] },
    { id: 'ol-pride-prejudice', provider: 'openlibrary', title: 'Pride and Prejudice', author: 'Jane Austen',
      cover: 'https://covers.openlibrary.org/b/olid/OL25428444M-L.jpg',
      href: '/read?provider=openlibrary&id=OL25428444M', subjects: ['Fiction','History'] },
  ],
  science: [
    { id: 'pg-relativity', provider: 'gutenberg', title: 'Relativity: The Special and General Theory', author: 'Albert Einstein',
      cover: 'https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=30155', subjects: ['Science','Physics'] },
    { id: 'ol-origin-darwin', provider: 'openlibrary', title: 'On the Origin of Species', author: 'Charles Darwin',
      cover: 'https://covers.openlibrary.org/b/olid/OL25442902M-L.jpg',
      href: '/read?provider=openlibrary&id=OL25442902M', subjects: ['Science','Biology'] },
    { id: 'ol-opticks-newton', provider: 'openlibrary', title: 'Opticks', author: 'Isaac Newton',
      cover: 'https://covers.openlibrary.org/b/olid/OL24263840M-L.jpg',
      href: '/read?provider=openlibrary&id=OL24263840M', subjects: ['Science','Physics'] },
    { id: 'pg-micrographia', provider: 'gutenberg', title: 'Micrographia', author: 'Robert Hooke',
      cover: 'https://www.gutenberg.org/cache/epub/15491/pg15491.cover.medium.jpg',
      href: '/read?provider=gutenberg&id=15491', subjects: ['Science'] },
  ],
};

const clamp = (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : []);
const norm = (b = {}) => ({
  id: String(b.id || b.key || ''),
  provider: String(b.provider || 'openlibrary'),
  title: String(b.title || 'Untitled'),
  author: String(b.author || b.authors || '').toString(),
  cover: String(b.cover || ''),
  href: b.href || `/read?provider=${encodeURIComponent(b.provider || 'openlibrary')}&id=${encodeURIComponent(b.id || '')}`,
  subjects: Array.isArray(b.subjects) ? b.subjects : [],
});
function ensureShelf(name, maybe, min = 8) {
  const src = Array.isArray(maybe) ? maybe : [];
  const out = clamp(src, 24).map(norm).filter((x) => x.cover);
  if (out.length >= min) return out;
  return clamp((FALLBACK[name] || []).map(norm), 24);
}

/* ----------------------------------
   DB helpers (homepage & watch)
----------------------------------- */
async function fetchCuratedBooks(limit = 24) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('curated_books')
    .select('id,title,author,cover_image,source_url,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  // map to homepage card shape
  return data.map((b) => ({
    id: b.id,
    provider: 'curated',
    title: b.title,
    author: b.author || '',
    cover: b.cover_image || '',
    href: b.source_url || '#',
    subjects: [],
  }));
}

async function fetchVideosWithGenres() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('videos')
    .select(`
      id, title, url, thumbnail, channel, created_at,
      video_genre_map (
        video_genres ( name )
      )
    `)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((v) => ({
    id: v.id,
    title: v.title,
    url: v.url,
    thumb: v.thumbnail || null,
    channel: v.channel || null,
    genres: (v.video_genre_map || [])
      .map((x) => x && x.video_genres && x.video_genres.name)
      .filter(Boolean)
      .map((s) => String(s).toLowerCase()),
  }));
}

async function fetchAllGenres() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('video_genres').select('name').order('name');
  if (error || !data) return [];
  return data.map((g) => g.name);
}

/* ----------------------------------
   Routes
----------------------------------- */

// Home (prefer curated_books for "Trending"; fallback to your static shelves)
router.get('/', async (req, res) => {
  let curated = [];
  try {
    curated = await fetchCuratedBooks(24);
  } catch (e) {
    curated = [];
  }

  const provided = (req.app && req.app.locals && req.app.locals.shelves) || {};
  const shelves = {
    // If you added curated books, use them as Trending; else fallback logic
    trending: curated.length ? clamp(curated, 24) : ensureShelf('trending', provided.trending),
    philosophy: ensureShelf('philosophy', provided.philosophy),
    history: ensureShelf('history', provided.history),
    science: ensureShelf('science', provided.science),
  };
  res.render('index', { shelves });
});

// Static pages
router.get('/about', (_req, res) => res.render('about'));

// Watch — list videos with optional genre filter (?genre=xxx)
router.get('/watch', async (req, res) => {
  const selected = String(req.query.genre || '').trim().toLowerCase();
  let videos = [];
  let genres = [];
  try {
    [videos, genres] = await Promise.all([fetchVideosWithGenres(), fetchAllGenres()]);
  } catch (e) {
    videos = [];
    genres = [];
  }

  if (selected) {
    videos = videos.filter((v) => v.genres.includes(selected));
  }

  res.render('watch', {
    videos,
    genres,
    selectedGenre: selected || '',
    referrer: req.get('Referrer') || null,
  });
});

router.get('/login', (_req, res) => res.render('login', { csrfToken: '' }));
router.get('/register', (_req, res) => res.render('register', { csrfToken: '' }));

// Read (expects provider & id via query)
router.get('/read', (req, res) => {
  const provider = String(req.query.provider || '');
  const id = String(req.query.id || '');
  res.render('read', { provider, id });
});

// Terms & Privacy
router.get('/terms', (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get('host')}/terms`;
  res.render('terms', {
    canonicalUrl,
    buildId: res.locals.buildId || Date.now(),
    referrer: req.get('Referrer') || null,
  });
});
router.get('/privacy', (req, res) => {
  const canonicalUrl = `${req.protocol}://${req.get('host')}/privacy`;
  res.render('privacy', {
    canonicalUrl,
    buildId: res.locals.buildId || Date.now(),
    referrer: req.get('Referrer') || null,
  });
});

// Contact (GET)
router.get('/contact', (req, res) => {
  const sent = req.query.sent === '1';
  const error = req.query.error || '';
  res.render('contact', { sent, error });
});

// Contact (POST) — keep your existing logic (mailer + DB best-effort)
router.post('/contact', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const message = String(req.body.message || '').trim();

  if (!name || !email || !message) {
    return res.status(400).render('contact', { sent: false, error: 'Please fill all fields.' });
  }

  const ip =
    (req.headers['x-forwarded-for'] && req.headers['x-forwarded-for'].split(',')[0].trim()) ||
    req.ip ||
    null;
  const userAgent = req.get('User-Agent') || null;

  try {
    if (supabase && typeof supabase.from === 'function') {
      const payload = { name, email, message, ip, user_agent: userAgent, created_at: new Date().toISOString() };
      const { error } = await supabase.from('contact_messages').insert(payload);
      if (error) console.error('[contact] insert failed:', error.message);
    } else {
      console.warn('[contact] Supabase not configured; skipping DB insert.');
    }
  } catch (e) {
    console.error('[contact] DB insert threw:', e);
  }

  try {
    // plug your mailer here if you have one (left as-is)
  } catch (e) {
    console.error('[contact] email send failed:', e && e.message ? e.message : e);
  }

  return res.redirect(303, '/contact?sent=1');
});

module.exports = router;
