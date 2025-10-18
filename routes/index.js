// routes/index.js — DYNAMIC SHELVES + WATCH GENRE FILTERS + existing pages
const express = require('express');
const router = express.Router();

/* -------------------------------
   Supabase (server / service role)
--------------------------------- */
let supabaseAdmin = null;
try {
  supabaseAdmin = require('../supabaseAdmin'); // exports client or null
} catch {
  supabaseAdmin = null;
}

/* -------------------------------
   Categories (single source of truth)
--------------------------------- */
let CATEGORIES = [];
try {
  CATEGORIES = require('../config/categories');
  if (!Array.isArray(CATEGORIES) || !CATEGORIES.length) CATEGORIES = ['trending','philosophy','history','science'];
} catch {
  CATEGORIES = ['trending','philosophy','history','science'];
}

/* -------------------------------
   Optional mailer helpers (unchanged)
--------------------------------- */
let mailer = null;
let legacySendContact = null;
try { mailer = require('../mailer'); } catch {}
if (!mailer) { try { legacySendContact = require('../mail/sendContact'); } catch {} }

// Minimal escape if mailer doesn’t supply it
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ----------------------------------
   Titles for auto-heading: Title Case
----------------------------------- */
function titleize(k = '') {
  const map = {
    trending: 'Trending Now',
    philosophy: 'Philosophy Picks',
    history: 'History Picks',
    science: 'Science Picks',
    biographies: 'Biographies',
    religion: 'Religion',
    classics: 'Classics',
  };
  return map[k] || (k.charAt(0).toUpperCase() + k.slice(1));
}

/* ----------------------------------
   FALLBACK (only for legacy 4 shelves)
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
function toCard(b = {}) {
  // maps curated_books row into the card partial expected by index.ejs
  return {
    id: String(b.id || ''),
    provider: 'admin', // local/admin source
    title: String(b.title || 'Untitled'),
    author: String(b.author || ''),
    cover: String(b.cover_image || ''),
    href: b.source_url || '#',
    subjects: [], // optional
  };
}

/* ----------------------------------
   In-memory cache (simple TTL)
----------------------------------- */
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = {
  shelves: { data: null, ts: 0 },
  genres: { data: null, ts: 0 },
  videosByGenre: {}, // { [genreId|null]: { data, ts } }
};

function isFresh(entry) {
  return entry && entry.data && (Date.now() - entry.ts) < TTL_MS;
}

/* ----------------------------------
   Build homepage shelves from curated_books
----------------------------------- */
async function fetchShelvesFromSupabase() {
  if (!supabaseAdmin) return null;
  const shelves = [];

  for (const cat of CATEGORIES) {
    const { data, error } = await supabaseAdmin
      .from('curated_books')
      .select('id,title,author,cover_image,source_url,category')
      .eq('category', cat)
      .order('created_at', { ascending: false })
      .limit(24);

    if (error) {
      console.warn('[home] curated_books select failed for', cat, error.message);
      shelves.push({ key: cat, title: titleize(cat), items: [] });
      continue;
    }

    const items = clamp((data || []).map(toCard).filter(x => x.cover), 24);
    shelves.push({ key: cat, title: titleize(cat), items });
  }

  return shelves;
}

/* ----------------------------------
   WATCH: genres + videos
----------------------------------- */
async function fetchGenres() {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from('video_genres')
    .select('id,name')
    .order('name', { ascending: true });
  if (error) { console.warn('[watch] video_genres failed:', error.message); return []; }
  return Array.isArray(data) ? data : [];
}

async function fetchVideosFiltered(genreId /* may be undefined/null */) {
  if (!supabaseAdmin) return [];

  // If no genre filter: get all videos
  if (!genreId) {
    const { data, error } = await supabaseAdmin
      .from('admin_videos')
      .select('id,title,url,channel,thumb,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) { console.warn('[watch] admin_videos failed:', error.message); return []; }
    return data || [];
  }

  // Join via mapping table
  const { data, error } = await supabaseAdmin
    .from('video_genres_map')
    .select('admin_videos(id,title,url,channel,thumb,created_at)')
    .eq('genre_id', genreId)
    .order('admin_videos(created_at)', { ascending: false });

  if (error) { console.warn('[watch] map join failed:', error.message); return []; }
  // data is rows with nested admin_videos
  return (data || []).map(r => r.admin_videos).filter(Boolean);
}

/* ----------------------------------
   Routes
----------------------------------- */

// Home — dynamic shelves
router.get('/', async (req, res) => {
  // Try cache
  if (isFresh(cache.shelves)) {
    return res.render('index', { shelves: cache.shelves.data });
  }

  // Prefer Supabase shelves
  let shelves = null;
  try { shelves = await fetchShelvesFromSupabase(); } catch {}

  // Fallback to legacy data for known 4; new categories will just show empty
  if (!shelves) {
    shelves = CATEGORIES.map(cat => ({
      key: cat,
      title: titleize(cat),
      items: clamp((FALLBACK[cat] || []), 24),
    }));
  } else {
    // Backfill any empty shelves with legacy data (only for legacy 4)
    shelves = shelves.map(s => {
      if (s.items && s.items.length) return s;
      if (FALLBACK[s.key]) return { ...s, items: clamp(FALLBACK[s.key], 24) };
      return s;
    });
  }

  cache.shelves = { data: shelves, ts: Date.now() };
  res.render('index', { shelves });
});

// Static pages (kept)
router.get('/about', (_req, res) => res.render('about'));

// WATCH — now with genre filters
router.get('/watch', async (req, res) => {
  const active = String(req.query.genre || '').trim() || '';
  let genres = [];
  let videos = [];

  // genres (cache)
  if (isFresh(cache.genres)) {
    genres = cache.genres.data;
  } else {
    genres = await fetchGenres();
    cache.genres = { data: genres, ts: Date.now() };
  }

  // find selected genre by name (support ?genre=name)
  let selected = null;
  if (active) {
    selected = genres.find(g => (g.name || '').toLowerCase() === active.toLowerCase()) || null;
  }

  const key = selected ? selected.id : 'ALL';
  if (cache.videosByGenre[key] && isFresh(cache.videosByGenre[key])) {
    videos = cache.videosByGenre[key].data;
  } else {
    videos = await fetchVideosFiltered(selected && selected.id);
    cache.videosByGenre[key] = { data: videos, ts: Date.now() };
  }

  res.render('watch', {
    videos,
    genres,             // [{id,name}]
    activeGenreName: selected ? selected.name : '',
  });
});

router.get('/login', (_req, res) => res.render('login', { csrfToken: '' }));
router.get('/register', (_req, res) => res.render('register', { csrfToken: '' }));

// Read (expects provider & id via query — unchanged)
router.get('/read', (req, res) => {
  const provider = String(req.query.provider || '');
  const id = String(req.query.id || '');
  res.render('read', { provider, id });
});

// Terms & Privacy (unchanged)
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

// Contact (POST) — save + email notify (unchanged)
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

  // 1) Store in Supabase (best effort)
  try {
    if (supabaseAdmin && typeof supabaseAdmin.from === 'function') {
      const payload = {
        name,
        email,
        message,
        ip,
        user_agent: userAgent,
        created_at: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin.from('contact_messages').insert(payload);
      if (error) console.error('[contact] insert failed:', error.message);
    } else {
      console.warn('[contact] Supabase not configured; skipping DB insert.');
    }
  } catch (e) {
    console.error('[contact] DB insert threw:', e);
  }

  // 2) Email notification (best effort)
  try {
    const to = process.env.CONTACT_NOTIFY_TO || process.env.MAIL_FROM || 'info@booklantern.org';

    if (mailer && typeof mailer.send === 'function') {
      const subj = `📮 Contact form: ${name || 'Someone'} (${email || 'no email'})`;
      const text =
`New contact message:

Name: ${name}
Email: ${email}
IP: ${ip}

Message:
${message}
`;
      const esc = mailer.escapeHtml || escapeHtml;
      const html =
`<h2>New contact message</h2>
<p><strong>Name:</strong> ${esc(name)}<br>
<strong>Email:</strong> ${esc(email)}<br>
<strong>IP:</strong> ${esc(ip || '')}</p>
<pre style="white-space:pre-wrap;font:inherit">${esc(message)}</pre>`;

      await mailer.send({ to, subject: subj, text, html });
    } else if (legacySendContact && typeof legacySendContact === 'function') {
      await legacySendContact({ to, name, email, message, ip, userAgent });
    } else {
      console.warn('[contact] No mailer configured; skipping email send.');
    }
  } catch (e) {
    console.error('[contact] email send failed:', e && e.message ? e.message : e);
  }

  // 3) Clean redirect
  return res.redirect(303, '/contact?sent=1');
});

module.exports = router;
