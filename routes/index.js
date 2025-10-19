// routes/index.js — public pages; reads from Supabase with service role if available
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // may be null
const categoriesCfg = (() => {
  try { return require('../config/categories'); } catch { return ['trending','philosophy','history','science']; }
})();

// Helper: title-case category key
function titleize(key) {
  return String(key || '').replace(/(^|[_-])([a-z])/g, (_, p1, p2) => (p1 ? ' ' : '') + p2.toUpperCase());
}

/* ============================================================
   HOME — shelves (curated_books by category)
   ============================================================ */
router.get('/', async (req, res) => {
  // If no Supabase, render page without shelves (still loads gracefully)
  if (!supabase) {
    return res.render('index', { shelvesList: [], hasSupabase: false });
  }

  const cats = Array.isArray(categoriesCfg) && categoriesCfg.length
    ? categoriesCfg
    : ['trending','philosophy','history','science'];

  try {
    // Fetch per-category shelves in parallel (limit to 12 each)
    const queries = cats.map(c =>
      supabase
        .from('curated_books')
        .select('*')
        .eq('category', c)
        .order('created_at', { ascending: false })
        .limit(12)
    );

    const results = await Promise.all(queries);
    const shelvesList = results.map((r, i) => ({
      key: cats[i],
      title: titleize(cats[i]),
      items: r.data || []
    }));

    return res.render('index', { shelvesList, hasSupabase: true });
  } catch (e) {
    console.error('[home] shelves load failed:', e);
    return res.render('index', { shelvesList: [], hasSupabase: true });
  }
});

/* ============================================================
   WATCH — videos (optional genre filter)
   ============================================================ */
router.get('/watch', async (req, res) => {
  const genreId = String(req.query.g || '').trim();

  if (!supabase) {
    return res.render('watch', {
      videos: [],
      genres: [],
      activeGenre: '',
      hasSupabase: false
    });
  }

  try {
    // Always load genres for the filter UI
    const [{ data: genres = [] }] = await Promise.all([
      supabase.from('video_genres').select('*').order('name', { ascending: true })
    ]);

    let videos = [];

    if (genreId) {
      // Filter by genre: get video ids from mapping then fetch videos
      const { data: mapRows = [], error: mErr } = await supabase
        .from('video_genres_map')
        .select('video_id')
        .eq('genre_id', genreId);
      if (mErr) throw mErr;

      const ids = mapRows.map(r => r.video_id);
      if (ids.length) {
        const { data: vids = [], error: vErr } = await supabase
          .from('admin_videos')
          .select('*')
          .in('id', ids)
          .order('created_at', { ascending: false });
        if (vErr) throw vErr;
        videos = vids;
      } else {
        videos = [];
      }
    } else {
      // No filter: show all
      const { data: vids = [], error: vErr } = await supabase
        .from('admin_videos')
        .select('*')
        .order('created_at', { ascending: false });
      if (vErr) throw vErr;
      videos = vids;
    }

    return res.render('watch', {
      videos,
      genres,
      activeGenre: genreId,
      hasSupabase: true
    });
  } catch (e) {
    console.error('[watch] load failed:', e);
    return res.render('watch', {
      videos: [],
      genres: [],
      activeGenre: '',
      hasSupabase: true
    });
  }
});

module.exports = router;
