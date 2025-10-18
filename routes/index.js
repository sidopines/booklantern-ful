// routes/index.js — Homepage + core pages (Supabase-powered shelves)
const express = require('express');
const router = express.Router();

/* ----------------------------------
   Optional Supabase server client
----------------------------------- */
let supabaseAdmin = null;
try {
  supabaseAdmin = require('../supabaseAdmin'); // exports client or null
} catch {
  supabaseAdmin = null;
}

/* ----------------------------------
   Categories (central config)
----------------------------------- */
let CATEGORIES = ['trending', 'philosophy', 'history', 'science'];
try {
  CATEGORIES = require('../config/categories');
} catch {
  // keep defaults
}

/* ----------------------------------
   Minimal escape (for emails)
----------------------------------- */
let mailer = null;
let legacySendContact = null;
try {
  mailer = require('../mailer'); // optional
} catch {}
if (!mailer) {
  try { legacySendContact = require('../mail/sendContact'); } catch {}
}
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ----------------------------------
   Fallback demo content (for legacy)
----------------------------------- */
const FALLBACK = {
  trending: [
    { id: 'ol-origin-darwin', title: 'On the Origin of Species', author: 'Charles Darwin',
      cover: 'https://covers.openlibrary.org/b/olid/OL25442902M-L.jpg',
      href: 'https://openlibrary.org/works/OL20612W' },
    { id: 'pg-relativity', title: 'Relativity: The Special and General Theory', author: 'Albert Einstein',
      cover: 'https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg',
      href: 'https://www.gutenberg.org/ebooks/30155' },
    { id: 'ol-benfranklin-autobio', title: 'The Autobiography of Benjamin Franklin', author: 'Benjamin Franklin',
      cover: 'https://covers.openlibrary.org/b/olid/OL24374150M-L.jpg',
      href: 'https://openlibrary.org/works/OL15854131W' },
  ],
  philosophy: [
    { id: 'pg-meditations', title: 'Meditations', author: 'Marcus Aurelius',
      cover: 'https://www.gutenberg.org/cache/epub/2680/pg2680.cover.medium.jpg',
      href: 'https://www.gutenberg.org/ebooks/2680' },
  ],
  history: [
    { id: 'pg-history-herodotus', title: 'The Histories', author: 'Herodotus',
      cover: 'https://www.gutenberg.org/cache/epub/2707/pg2707.cover.medium.jpg',
      href: 'https://www.gutenberg.org/ebooks/2707' },
  ],
  science: [
    { id: 'pg-relativity', title: 'Relativity: The Special and General Theory', author: 'Albert Einstein',
      cover: 'https://www.gutenberg.org/cache/epub/30155/pg30155.cover.medium.jpg',
      href: 'https://www.gutenberg.org/ebooks/30155' },
  ],
};

/* ----------------------------------
   Helpers
----------------------------------- */
const TitleMap = {
  trending: 'Trending now',
  philosophy: 'Philosophy Picks',
  history: 'History Picks',
  science: 'Science Picks',
};
function prettyTitle(cat) {
  if (TitleMap[cat]) return TitleMap[cat];
  // Title Case fallback
  return String(cat)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeBook(row = {}) {
  return {
    id: String(row.id || ''),
    title: String(row.title || 'Untitled'),
    author: row.author ? String(row.author) : '',
    cover: row.cover_image ? String(row.cover_image) : '',
    href: row.source_url ? String(row.source_url) : '#',
  };
}

/* ----------------------------------
   Homepage: build shelves from Supabase
----------------------------------- */
async function fetchShelvesFromSupabase(categories) {
  if (!supabaseAdmin) return null;
  const out = {};
  // Pull all relevant rows in one shot if possible
  const { data, error } = await supabaseAdmin
    .from('curated_books')
    .select('id,title,author,cover_image,source_url,category')
    .in('category', categories)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[index] curated_books query failed:', error.message);
    return null;
  }
  // Group by category & normalize
  for (const c of categories) out[c] = [];
  for (const row of (Array.isArray(data) ? data : [])) {
    if (!row || !row.category) continue;
    if (!out[row.category]) out[row.category] = [];
    const normalized = normalizeBook(row);
    if (normalized.cover) out[row.category].push(normalized);
  }
  return out;
}

function applyFallbacks(shelvesObj) {
  const result = { ...shelvesObj };
  for (const cat of CATEGORIES) {
    const arr = Array.isArray(result[cat]) ? result[cat] : [];
    if (arr.length > 0) continue;
    if (Array.isArray(FALLBACK[cat]) && FALLBACK[cat].length) {
      result[cat] = FALLBACK[cat];
    } else {
      result[cat] = []; // leave empty if no fallback for new category
    }
  }
  return result;
}

/* ----------------------------------
   Routes
----------------------------------- */

// Home
router.get('/', async (_req, res) => {
  try {
    let shelves = {};
    // Try Supabase
    const live = await fetchShelvesFromSupabase(CATEGORIES);
    if (live) shelves = live;
    // Apply fallbacks if any category is empty
    shelves = applyFallbacks(shelves);

    // Build a render-friendly array: [{ key, title, items }]
    const shelvesList = CATEGORIES.map((key) => ({
      key,
      title: prettyTitle(key),
      items: Array.isArray(shelves[key]) ? shelves[key] : [],
    }));

    return res.render('index', { shelvesList });
  } catch (e) {
    console.error('[home] render failed:', e);
    // Fall back to a tiny static page if something explodes
    return res.render('index', {
      shelvesList: (Object.keys(FALLBACK)).map((k) => ({
        key: k,
        title: prettyTitle(k),
        items: FALLBACK[k],
      })),
    });
  }
});

// Static pages
router.get('/about', (_req, res) => res.render('about'));

// Watch — if you have a dedicated watch router, you can remove this fallback
router.get('/watch', (_req, res) => res.render('watch', { videos: [] }));

router.get('/login', (_req, res) => res.render('login', { csrfToken: '' }));
router.get('/register', (_req, res) => res.render('register', { csrfToken: '' }));

// Read (expects provider & id via query — legacy support)
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

// Contact (POST) — save + email notify (best effort)
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
      const payload = { name, email, message, ip, user_agent: userAgent, created_at: new Date().toISOString() };
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

  return res.redirect(303, '/contact?sent=1');
});

module.exports = router;
