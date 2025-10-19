// routes/index.js — public routes with safe params + basic pages + /api/book
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // can be null

// ---------------- helpers ----------------

const DEFAULT_SHELVES = [
  'trending',
  'philosophy',
  'history',
  'science',
  'biographies',
  'religion',
  'classics',
];

function safeRender(res, view, params, fallbackHtml) {
  try {
    return res.render(view, params);
  } catch (_e) {
    const html =
      fallbackHtml ||
      `<h1>${params?.pageTitle || 'Page'}</h1><p>Template <code>${view}</code> not found (fallback).</p>`;
    return res.status(200).send(html);
  }
}

function groupByCategory(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    const c = (r.category || '').toLowerCase();
    if (!out[c]) out[c] = [];
    out[c].push(r);
  });
  return out;
}

// ---------------- Homepage ----------------

router.get('/', async (req, res) => {
  const shelvesList = DEFAULT_SHELVES.slice();
  let shelvesData = Object.fromEntries(shelvesList.map((c) => [c, []]));

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('curated_books')
        .select('*')
        .in('category', shelvesList)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const grouped = groupByCategory(data);
        shelvesData = Object.fromEntries(
          shelvesList.map((c) => [c, (grouped[c] || []).slice(0, 10)])
        );
      }
    } catch (e) {
      console.warn('[home] curated_books fetch failed:', e.message || e);
    }
  }

  return safeRender(res, 'index', { pageTitle: 'BookLantern', shelvesList, shelvesData });
});

// ---------------- Watch -------------------

router.get('/watch', async (req, res) => {
  const selectedGenre = String(req.query.genre || '');
  let genres = [];
  let videos = [];

  if (supabase) {
    try {
      const { data: g, error: gErr } = await supabase
        .from('video_genres')
        .select('*')
        .order('name', { ascending: true });
      if (!gErr && Array.isArray(g)) genres = g;

      const { data: v, error: vErr } = await supabase
        .from('admin_videos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(24);
      if (!vErr && Array.isArray(v)) videos = v;
    } catch (e) {
      console.warn('[watch] fetch failed:', e.message || e);
    }
  }

  return safeRender(res, 'watch', {
    pageTitle: 'Watch',
    genres,
    videos,
    selectedGenre,
  });
});

// ---------------- Read --------------------

router.get('/read', (req, res) => {
  const provider = String(req.query.provider || '');
  const id = String(req.query.id || '');

  return safeRender(res, 'read', { pageTitle: 'Read', provider, id });
});

// ----------- Basic content pages ----------

router.get('/about', (req, res) => safeRender(res, 'about', { pageTitle: 'About' }));
router.get('/contact', (req, res) => safeRender(res, 'contact', { pageTitle: 'Contact' }));
router.get('/login', (req, res) => safeRender(res, 'login', { pageTitle: 'Login' }));
router.get('/register', (req, res) => safeRender(res, 'register', { pageTitle: 'Create account' }));
router.get('/privacy', (req, res) => safeRender(res, 'privacy', { pageTitle: 'Privacy' }));
router.get('/terms', (req, res) => safeRender(res, 'terms', { pageTitle: 'Terms' }));

// ---------------- Search ------------------

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  return safeRender(res, 'search', { pageTitle: 'Search', q, results: [] });
});

// ---------------- API: book ---------------
// Avoids the 404 spam when /read loads without provider/id.
// Returns 404 with a clear JSON error if params are missing.
router.get('/api/book', (req, res) => {
  const provider = String(req.query.provider || '').trim();
  const id = String(req.query.id || '').trim();
  if (!provider || !id) {
    return res.status(404).json({ error: 'missing_provider_or_id' });
  }

  // If you later want to actually fetch a book, do it here.
  // For now we just return a placeholder payload so the client code won’t crash.
  return res.json({
    provider,
    id,
    title: null,
    content: null,
    ok: true,
  });
});

module.exports = router;
