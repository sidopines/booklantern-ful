// routes/index.js — public site routes with safe view params & 404-free basics
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role client (can be null)

// ---- helpers ---------------------------------------------------------------

const DEFAULT_SHELVES = [
  'trending',
  'philosophy',
  'history',
  'science',
  'biographies',
  'religion',
  'classics',
];

/**
 * Render a view, but if the EJS file is missing, send a minimal HTML fallback
 * so the route never 404s during deployment.
 */
function safeRender(res, view, params, fallbackHtml) {
  try {
    return res.render(view, params);
  } catch (e) {
    // If the template is missing, send fallback HTML instead of 404
    const html =
      fallbackHtml ||
      `<h1>${params?.pageTitle || 'Page'}</h1><p>Template <code>${view}</code> not found. This is a fallback.</p>`;
    return res.status(200).send(html);
  }
}

/**
 * Group an array of rows by "category" into an object { category: [rows...] }
 */
function groupByCategory(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    const c = (r.category || '').toLowerCase();
    if (!out[c]) out[c] = [];
    out[c].push(r);
  });
  return out;
}

// ---- homepage --------------------------------------------------------------

router.get('/', async (req, res) => {
  const shelvesList = DEFAULT_SHELVES.slice(); // ensure defined
  let shelvesData = {}; // ensure defined

  if (supabase) {
    try {
      // Pull all rows for our shelves in one query, newest first
      const { data, error } = await supabase
        .from('curated_books')
        .select('*')
        .in('category', shelvesList)
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const grouped = groupByCategory(data);
        // Trim to 10 per shelf for the homepage
        shelvesData = Object.fromEntries(
          shelvesList.map((c) => [c, (grouped[c] || []).slice(0, 10)])
        );
      } else {
        shelvesData = Object.fromEntries(shelvesList.map((c) => [c, []]));
      }
    } catch (e) {
      console.warn('[home] curated_books fetch failed:', e.message || e);
      shelvesData = Object.fromEntries(shelvesList.map((c) => [c, []]));
    }
  } else {
    // No DB client — keep everything defined to avoid template errors
    shelvesData = Object.fromEntries(shelvesList.map((c) => [c, []]));
  }

  return safeRender(
    res,
    'index',
    {
      pageTitle: 'BookLantern',
      shelvesList,
      shelvesData,
    },
    `<h1>BookLantern</h1><p>Homepage fallback (template missing). Shelves are defined.</p>`
  );
});

// ---- watch (videos page) ---------------------------------------------------

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

      // Basic feed of latest videos. (We can add genre filtering/JOIN later.)
      const vQuery = supabase
        .from('admin_videos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(24);

      const { data: v, error: vErr } = await vQuery;
      if (!vErr && Array.isArray(v)) videos = v;
    } catch (e) {
      console.warn('[watch] fetch failed:', e.message || e);
    }
  }

  return safeRender(
    res,
    'watch',
    {
      pageTitle: 'Watch',
      genres,
      videos,
      selectedGenre, // IMPORTANT: template expects this
    },
    `<h1>Watch</h1><p>Fallback page. Genres loaded: ${genres.length}. Videos: ${videos.length}.</p>`
  );
});

// ---- read (book reader) ----------------------------------------------------
// The template references `provider` and `id` for localStorage keys, so we
// ALWAYS pass them (empty strings if missing) to prevent crashes.
router.get('/read', async (req, res) => {
  const provider = String(req.query.provider || '');
  const id = String(req.query.id || '');

  // If you later want to prefetch metadata, you can do it here.
  // For now we just make sure the template never crashes.
  return safeRender(
    res,
    'read',
    {
      pageTitle: 'Read',
      provider,
      id,
    },
    `<h1>Read</h1><p>Fallback page. provider="<code>${provider}</code>", id="<code>${id}</code>".</p>`
  );
});

// ---- basic content pages (non-404 stubs if views are missing) --------------

router.get('/about', (req, res) =>
  safeRender(res, 'about', { pageTitle: 'About' }, '<h1>About</h1>')
);

router.get('/contact', (req, res) =>
  safeRender(res, 'contact', { pageTitle: 'Contact' }, '<h1>Contact</h1>')
);

router.get('/login', (req, res) =>
  safeRender(res, 'login', { pageTitle: 'Login' }, '<h1>Login</h1>')
);

router.get('/register', (req, res) =>
  safeRender(res, 'register', { pageTitle: 'Create account' }, '<h1>Create account</h1>')
);

router.get('/privacy', (req, res) =>
  safeRender(res, 'privacy', { pageTitle: 'Privacy' }, '<h1>Privacy</h1>')
);

router.get('/terms', (req, res) =>
  safeRender(res, 'terms', { pageTitle: 'Terms' }, '<h1>Terms</h1>')
);

// ---- search placeholder so /search never 404s ------------------------------

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();

  // Minimal placeholder that renders successfully even without a view.
  return safeRender(
    res,
    'search',
    { pageTitle: 'Search', q, results: [] },
    `<h1>Search</h1><p>Query: <em>${q || '(empty)'}</em>. Template fallback.</p>`
  );
});

module.exports = router;
