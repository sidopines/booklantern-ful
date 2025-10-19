// routes/index.js — public site routes (homepage + watch + simple statics)
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role read is fine for public pages
let CATEGORIES;
try {
  CATEGORIES = require('../config/categories'); // ['trending','philosophy',...]
  if (!Array.isArray(CATEGORIES)) CATEGORIES = [];
} catch {
  CATEGORIES = ['trending', 'philosophy', 'history', 'science'];
}

/**
 * Helper: fetch curated books grouped by category.
 * Always returns an array of { key, label, items } so the view never breaks.
 */
async function loadShelves(limitPerShelf = 12) {
  // Default “empty shelves” shape
  const base = CATEGORIES.map((key) => ({
    key,
    label: key.charAt(0).toUpperCase() + key.slice(1),
    items: [],
  }));

  if (!supabase) return base;

  try {
    // Grab everything we need in one query then bucket in memory
    const { data, error } = await supabase
      .from('curated_books')
      .select('*')
      .in('category', CATEGORIES)
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return base;

    const buckets = Object.fromEntries(
      CATEGORIES.map((k) => [k, []])
    );

    for (const row of data) {
      const k = row.category;
      if (buckets[k] && buckets[k].length < limitPerShelf) {
        buckets[k].push({
          id: row.id,
          title: row.title,
          author: row.author || '',
          cover_image: row.cover_image || '',
          source_url: row.source_url || '',
          created_at: row.created_at,
        });
      }
    }

    return CATEGORIES.map((key) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      items: buckets[key] || [],
    }));
  } catch {
    return base;
  }
}

/* ============================================================
   Homepage
   ============================================================ */
router.get('/', async (req, res) => {
  try {
    const shelvesList = await loadShelves(12);
    res.render('index', {
      canonicalUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      shelvesList,
    });
  } catch (e) {
    console.error('[index] render failed:', e);
    // Extremely defensive fallback so the site never 500s
    res.render('index', {
      canonicalUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
      shelvesList: CATEGORIES.map((key) => ({
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        items: [],
      })),
    });
  }
});

/* ============================================================
   Watch page (videos + optional genre filter)
   ============================================================ */
router.get('/watch', async (req, res) => {
  const selectedGenre = (req.query.genre || '').trim(); // id or empty string

  // Defaults so the template can always render
  let genres = [];
  let videos = [];

  if (!supabase) {
    return res.render('watch', {
      genres,
      videos,
      selectedGenre,
    });
  }

  try {
    // Load genres (for filter dropdown)
    const { data: gData, error: gErr } = await supabase
      .from('video_genres')
      .select('*')
      .order('name', { ascending: true });
    if (!gErr && Array.isArray(gData)) genres = gData;

    if (selectedGenre) {
      // Filtered by genre id: join mapping -> videos
      const { data: mData, error: mErr } = await supabase
        .from('video_genres_map')
        .select('video_id')
        .eq('genre_id', selectedGenre);
      if (mErr || !Array.isArray(mData) || !mData.length) {
        videos = [];
      } else {
        const ids = mData.map((m) => m.video_id);
        const { data: vData, error: vErr } = await supabase
          .from('admin_videos')
          .select('*')
          .in('id', ids)
          .order('created_at', { ascending: false });
        if (!vErr && Array.isArray(vData)) videos = vData;
      }
    } else {
      // Unfiltered: latest videos
      const { data: vData, error: vErr } = await supabase
        .from('admin_videos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!vErr && Array.isArray(vData)) videos = vData;
    }

    return res.render('watch', {
      genres,
      videos,
      selectedGenre, // << ensures template never throws
    });
  } catch (e) {
    console.error('[watch] render failed:', e);
    return res.render('watch', {
      genres,
      videos,
      selectedGenre,
    });
  }
});

/* ============================================================
   Simple statics / fallbacks (prevent 404s)
   If you already render these elsewhere, these will just work.
   ============================================================ */
router.get('/about', (req, res) => {
  try {
    res.render('about');
  } catch {
    res.status(200).send('<h1>About</h1><p>Coming soon.</p>');
  }
});

router.get('/contact', (req, res) => {
  try {
    res.render('contact');
  } catch {
    res.status(200).send('<h1>Contact</h1><p>Coming soon.</p>');
  }
});

router.get('/read', (req, res) => {
  try {
    res.render('read');
  } catch {
    res.status(200).send('<h1>Read</h1><p>Coming soon.</p>');
  }
});

// Gentle fallbacks so /login and /register never 404, even if loginShim isn’t mounted.
router.get('/login', (req, res) => {
  try {
    res.render('login');
  } catch {
    res.status(200).send('<h1>Login</h1><p>Use magic link from the homepage Account button.</p>');
  }
});
router.get('/register', (req, res) => {
  try {
    res.render('register');
  } catch {
    res.status(200).send('<h1>Create account</h1><p>Use the Account button to get a magic link.</p>');
  }
});

module.exports = router;
