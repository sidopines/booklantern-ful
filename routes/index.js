// routes/index.js — FINAL (Supabase-powered homepage + watch)
const express = require('express');
const router = express.Router();

/* -------------------------------
   Optional Supabase server client
--------------------------------- */
let supabaseAdmin = null;
try {
  supabaseAdmin = require('../supabaseAdmin'); // exports client or null
} catch {
  supabaseAdmin = null;
}

/* -------------------------------
   Optional mailer helpers
--------------------------------- */
let mailer = null;
let legacySendContact = null;
try { mailer = require('../mailer'); } catch {}
if (!mailer) {
  try { legacySendContact = require('../mail/sendContact'); } catch {}
}

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
   Homepage shelves (safe fallbacks)
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

/* ---------- Admin-curated: featured_books -> trending shelf ---------- */
async function fetchFeaturedBooks() {
  if (!supabaseAdmin) return [];
  try {
    // expected table columns (tolerant): title, author, cover_url, href OR provider+book_id
    const { data, error } = await supabaseAdmin
      .from('featured_books')
      .select('*')
      .order('sort_order', { ascending: true })
      .limit(24);

    if (error || !Array.isArray(data)) return [];
    return data.map((row) => {
      const provider = row.provider || row.src_provider || 'openlibrary';
      const bookId   = row.book_id || row.src_id || row.id || '';
      const href     =
        row.href ||
        (bookId ? `/read?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(bookId)}` : '#');

      return {
        id: String(bookId || row.slug || row.id || ''),
        provider,
        title: row.title || 'Untitled',
        author: row.author || '',
        cover: row.cover || row.cover_url || '',
        href,
        subjects: Array.isArray(row.subjects) ? row.subjects : [],
      };
    }).filter((x) => x.cover);
  } catch (e) {
    console.warn('[home] featured_books fetch failed:', e.message || e);
    return [];
  }
}

/* ----------------------------------
   Routes
----------------------------------- */

// Home
router.get('/', async (req, res) => {
  // 1) try admin-curated "featured_books" into trending
  let curated = [];
  try { curated = await fetchFeaturedBooks(); } catch {}

  // 2) also allow programmatic shelves from app.locals.shelves
  const provided = (req.app && req.app.locals && req.app.locals.shelves) || {};

  const shelves = {
    trending: ensureShelf('trending', curated.length ? curated : provided.trending),
    philosophy: ensureShelf('philosophy', provided.philosophy),
    history: ensureShelf('history', provided.history),
    science: ensureShelf('science', provided.science),
  };
  res.render('index', { shelves });
});

// Static pages
router.get('/about', (_req, res) => res.render('about'));

// WATCH: pull from Supabase "videos"
router.get('/watch', async (_req, res) => {
  let videos = [];
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('videos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(48);
      if (!error && Array.isArray(data)) {
        videos = data.map(v => ({
          title: v.title || 'Untitled video',
          url: v.url || '#',
          thumb: v.thumb || v.thumbnail || null,
          slug: v.slug || null,
          video_id: v.video_id || null,
          description: v.description || null,
        }));
      }
    } catch (e) {
      console.warn('[watch] videos fetch failed:', e.message || e);
    }
  }
  res.render('watch', { videos });
});

// Optional detail page if you keep watch-show.ejs
router.get('/watch/:slug', async (req, res) => {
  const slug = String(req.params.slug || '');
  let video = null;
  if (supabaseAdmin && slug) {
    try {
      const { data, error } = await supabaseAdmin
        .from('videos')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      if (!error && data) {
        // derive videoId for YouTube if not explicitly stored
        const vid = data.video_id || extractYouTubeId(data.url || '') || '';
        video = {
          title: data.title || 'Video',
          videoId: vid,
          description: data.description || '',
        };
      }
    } catch (e) {}
  }
  res.render('watch-show', { video });
});

function extractYouTubeId(u) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    if (url.pathname.startsWith('/embed/')) return url.pathname.split('/embed/')[1];
  } catch {}
  return '';
}

// Login/Register
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

// Contact (POST) — save + email notify
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
