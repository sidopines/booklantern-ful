// routes/index.js — public site pages; always pass safe locals to views
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role, may be null

// Util: safe array
const arr = (v) => (Array.isArray(v) ? v : []);

// -----------------------------
// Homepage
// -----------------------------
router.get('/', async (_req, res) => {
  // Shelves the homepage expects (you can change names later)
  const shelvesList = [
    'trending',
    'philosophy',
    'history',
    'science',
    'biographies',
    'religion',
    'classics'
  ];

  // Try to fetch minimal “trending” item so the page doesn’t look empty.
  // If Supabase isn’t configured or query fails, we just render with empty data.
  let shelvesData = {};
  if (supabase) {
    try {
      // Example: pull 1 featured book if you have such a table; otherwise leave empty.
      const { data: featured } = await supabase
        .from('featured_books')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

      shelvesData.trending = featured || [];
    } catch (_e) {
      shelvesData = {};
    }
  }

  return res.render('index', {
    shelvesList,
    shelvesData
  });
});

// -----------------------------
// Watch (videos catalogue page)
// -----------------------------
router.get('/watch', async (req, res) => {
  const selectedGenre = typeof req.query.genre === 'string' ? req.query.genre : '';

  let genres = [];
  let videos = [];

  if (supabase) {
    try {
      const gq = supabase.from('video_genres').select('*').order('name', { ascending: true });
      const vq = supabase.from('admin_videos').select('*').order('created_at', { ascending: false });

      const [g, v] = await Promise.all([gq, vq]);
      genres = g.data || [];
      videos = v.data || [];
    } catch (_e) {
      genres = [];
      videos = [];
    }
  }

  return res.render('watch', {
    genres,
    selectedGenre,
    videos
  });
});

// -----------------------------
// Read (reader shell)
// Requires ?provider=...&id=...
// -----------------------------
router.get('/read', (req, res) => {
  const provider = typeof req.query.provider === 'string' ? req.query.provider : '';
  const id = typeof req.query.id === 'string' ? req.query.id : '';

  // DO NOT error if missing; template will gracefully show instructions.
  return res.render('read', {
    provider,
    id
  });
});

// -----------------------------
// Static pages
// -----------------------------
router.get('/about', (_req, res) => res.render('about', {}));
router.get('/contact', (_req, res) => res.render('contact', {}));
router.get('/privacy', (_req, res) => res.render('privacy', {}));
router.get('/terms', (_req, res) => res.render('terms', {}));

// -----------------------------
// Minimal search stub (avoid 404 while you wire actual search)
// -----------------------------
router.get('/search', (_req, res) => {
  return res.render('search', { query: '', results: [] });
});

module.exports = router;
