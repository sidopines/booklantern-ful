// routes/index.js — public site pages; always pass safe locals to views
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role, may be null

// Helpers ---------------------------------------------------
const isArr = (v) => Array.isArray(v) ? v : [];

// Very small YouTube helpers (safe fallbacks if URL not YouTube)
function ytIdFromUrl(url = '') {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      // /embed/<id> or /shorts/<id>
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' && parts[1]) return parts[1];
      if (parts[0] === 'shorts' && parts[1]) return parts[1];
    }
  } catch {}
  return '';
}
function ytThumb(id) {
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}
function toPlayerHref(id) {
  return `/video/${encodeURIComponent(id)}`;
}

// -----------------------------
// Homepage
// -----------------------------
router.get('/', async (_req, res) => {
  const shelvesList = [
    'trending',
    'philosophy',
    'history',
    'science',
    'biographies',
    'religion',
    'classics'
  ];

  let shelvesData = {};
  if (supabase) {
    try {
      const { data: featured } = await supabase
        .from('featured_books')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);
      shelvesData.trending = featured || [];
    } catch {
      shelvesData = {};
    }
  }

  return res.render('index', { shelvesList, shelvesData });
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

      // If a genre is selected, filter videos using the mapping table
      if (selectedGenre) {
        const { data: maps = [] } = await supabase
          .from('video_genres_map')
          .select('video_id')
          .eq('genre_id', selectedGenre);
        const allowIds = new Set(isArr(maps).map(m => m.video_id));
        videos = videos.filter(v => allowIds.has(v.id));
      }

      // decorate with derived thumb + internal link
      videos = videos.map(v => {
        const yid = ytIdFromUrl(v.url || '');
        const derived = !v.thumb ? ytThumb(yid) : v.thumb;
        return { ...v, derivedThumb: derived, playerHref: toPlayerHref(v.id) };
      });
    } catch {
      genres = [];
      videos = [];
    }
  }

  return res.render('watch', { genres, selectedGenre, videos });
});

// -----------------------------
// Video player page (keeps users on site)
// -----------------------------
router.get('/video/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!id || !supabase) return res.status(404).render('404');

  try {
    const { data: v, error } = await supabase
      .from('admin_videos')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !v) return res.status(404).render('404');

    // Build an embed URL (YouTube supported; fallback is external link)
    const yid = ytIdFromUrl(v.url || '');
    const embedSrc = yid
      ? `https://www.youtube-nocookie.com/embed/${yid}?rel=0& modestbranding=1`
      : '';

    return res.render('video', { video: v, embedSrc });
  } catch {
    return res.status(500).render('error', { error: new Error('Failed to load video') });
  }
});

// -----------------------------
// Read (reader shell) — requires ?provider and ?id
// -----------------------------
router.get('/read', (req, res) => {
  const provider = typeof req.query.provider === 'string' ? req.query.provider : '';
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  return res.render('read', { provider, id });
});

// -----------------------------
// Static pages
// -----------------------------
router.get('/about', (_req, res) => res.render('about', {}));
router.get('/contact', (_req, res) => res.render('contact', {}));
router.get('/privacy', (_req, res) => res.render('privacy', {}));
router.get('/terms', (_req, res) => res.render('terms', {}));

// -----------------------------
// Minimal search stub
// -----------------------------
router.get('/search', (_req, res) => res.render('search', { query: '', results: [] }));

module.exports = router;
