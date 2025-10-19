// routes/index.js — public site routes (homepage shelves + watch)
// Uses the service-role client for simplicity (read-only to public tables via RLS “select” policies)

const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role client or null
const CATEGORIES = (() => {
  try { return require('../config/categories'); } catch { return ['trending','philosophy','history','science']; }
})();

// Util: safe array
const arr = (x) => (Array.isArray(x) ? x : []);

/* ============================================================
   Homepage — dynamic shelves from curated_books
   ============================================================ */
router.get('/', async (req, res) => {
  // If Supabase isn’t configured, render with empty shelves (site still loads)
  if (!supabase) {
    return res.render('index', {
      shelvesList: CATEGORIES,
      shelvesData: {},
      pageTitle: 'BookLantern — Read freely',
    });
  }

  try {
    // Fetch up to N items per shelf (tweak as you like)
    const LIMIT_PER_SHELF = 12;

    const queries = CATEGORIES.map((cat) =>
      supabase
        .from('curated_books')
        .select('*')
        .eq('category', cat)
        .order('created_at', { ascending: false })
        .limit(LIMIT_PER_SHELF)
    );

    const results = await Promise.all(queries);

    const shelvesData = {};
    results.forEach((r, i) => {
      const cat = CATEGORIES[i];
      if (r.error) {
        console.warn(`[home] shelf "${cat}" load error:`, r.error.message || r.error);
        shelvesData[cat] = [];
      } else {
        shelvesData[cat] = arr(r.data);
      }
    });

    res.render('index', {
      shelvesList: CATEGORIES,
      shelvesData,
      pageTitle: 'BookLantern — Read freely',
    });
  } catch (e) {
    console.error('[home] shelves failed:', e);
    res.render('index', {
      shelvesList: CATEGORIES,
      shelvesData: {},
      pageTitle: 'BookLantern — Read freely',
    });
  }
});

/* ============================================================
   Watch — videos + genres (optional ?genre=<uuid> filter)
   ============================================================ */
router.get('/watch', async (req, res) => {
  if (!supabase) {
    // Render with empty lists but no crash
    return res.render('watch', {
      pageTitle: 'Watch — BookLantern',
      videos: [],
      genres: [],
      selectedGenre: '',
      // map of videoId -> [{id,name}]
      videoGenres: {},
    });
  }

  try {
    const selectedGenre = String(req.query.genre || '').trim();

    // Always load genres for the filter UI
    const { data: genres = [], error: gErr } = await supabase
      .from('video_genres')
      .select('*')
      .order('name', { ascending: true });

    if (gErr) throw gErr;

    let videos = [];
    if (selectedGenre) {
      // 1) find video_ids that have this genre
      const { data: mapRows = [], error: mErr } = await supabase
        .from('video_genres_map')
        .select('video_id')
        .eq('genre_id', selectedGenre);

      if (mErr) throw mErr;

      const ids = [...new Set(mapRows.map(r => r.video_id))];
      if (ids.length === 0) {
        videos = [];
      } else {
        const { data: vids = [], error: vErr } = await supabase
          .from('admin_videos')
          .select('*')
          .in('id', ids)
          .order('created_at', { ascending: false });
        if (vErr) throw vErr;
        videos = arr(vids);
      }
    } else {
      // No filter: load latest
      const { data: vids = [], error: vErr } = await supabase
        .from('admin_videos')
        .select('*')
        .order('created_at', { ascending: false });
      if (vErr) throw vErr;
      videos = arr(vids);
    }

    // Build a map: videoId -> [{id,name}]
    let videoGenres = {};
    if (videos.length) {
      const ids = videos.map(v => v.id);
      const { data: vgm = [], error: jErr } = await supabase
        .from('video_genres_map')
        .select('video_id, genre_id')
        .in('video_id', ids);
      if (jErr) throw jErr;

      // Build lookup for genre_id -> name
      const byId = new Map(genres.map(g => [g.id, g.name]));
      const map = {};
      vgm.forEach(({ video_id, genre_id }) => {
        if (!map[video_id]) map[video_id] = [];
        map[video_id].push({ id: genre_id, name: byId.get(genre_id) || 'Unknown' });
      });
      videoGenres = map;
    }

    res.render('watch', {
      pageTitle: 'Watch — BookLantern',
      videos,
      genres,
      selectedGenre,
      videoGenres,
    });
  } catch (e) {
    console.error('[watch] render failed:', e);
    res.render('watch', {
      pageTitle: 'Watch — BookLantern',
      videos: [],
      genres: [],
      selectedGenre: '',
      videoGenres: {},
    });
  }
});

module.exports = router;
