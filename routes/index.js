// routes/index.js — public site pages; always pass safe locals to views
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role, may be null

// Helpers
const arr = (v) => (Array.isArray(v) ? v : []);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

// Parse a YouTube url to an object: { id, embedUrl, thumb }
function parseYouTube(url) {
  if (!isStr(url)) return null;
  try {
    const u = new URL(url);
    let id = '';
    if (u.hostname === 'youtu.be') {
      id = u.pathname.replace(/^\/+/, '');
    } else if (u.hostname.includes('youtube.com')) {
      if (u.searchParams.get('v')) id = u.searchParams.get('v');
      const m = u.pathname.match(/\/(embed|shorts)\/([^/?#]+)/);
      if (!id && m) id = m[2];
    }
    if (!id) return null;
    const embedUrl = `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
    const thumb = `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    return { id, embedUrl, thumb };
  } catch {
    return null;
  }
}

// -----------------------------
// Homepage
// -----------------------------
router.get('/', async (_req, res) => {
  const shelvesList = ['trending','philosophy','history','science','biographies','religion','classics'];

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
  const selectedGenre = isStr(req.query.genre) ? req.query.genre : '';

  let genres = [];
  let videos = [];

  if (supabase) {
    try {
      const gq = supabase
        .from('video_genres')
        .select('*')
        .order('name', { ascending: true });

      const vq = supabase
        .from('admin_videos')
        .select('*')
        .order('created_at', { ascending: false });

      const [g, v] = await Promise.all([gq, vq]);
      genres = g.data || [];
      videos = v.data || [];

      if (selectedGenre) {
        const { data: maps = [] } = await supabase
          .from('video_genres_map')
          .select('video_id')
          .eq('genre_id', selectedGenre);

        const allowed = new Set(maps.map((m) => m.video_id));
        videos = videos.filter((vid) => allowed.has(vid.id));
      }

      // derive thumbs and safe URLs
      videos = videos.map((v) => {
        const y = parseYouTube(v.url);
        const derivedThumb = y?.thumb || null;
        const safeUrl = y?.embedUrl || v.url || null;
        return {
          ...v,
          _derivedThumb: derivedThumb,
          _safeOutbound: safeUrl
        };
      });
    } catch {
      genres = [];
      videos = [];
    }
  }

  return res.render('watch', { genres, selectedGenre, videos });
});

// -----------------------------
// Video player page
// -----------------------------
router.get('/video/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id || !supabase) return res.status(404).render('404');

  try {
    const { data: v, error } = await supabase
      .from('admin_videos')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !v) return res.status(404).render('404');

    const y = parseYouTube(v.url);
    const embedUrl = y?.embedUrl || null;
    const thumb = v.thumb || y?.thumb || null;

    return res.render('video', {
      video: {
        id: v.id,
        title: v.title,
        channel: v.channel,
        url: v.url,
        embedUrl,
        thumb
      }
    });
  } catch (e) {
    console.error('[video] fetch failed:', e);
    return res.status(500).render('error', { error: e });
  }
});

// -----------------------------
// Read (reader shell) — redirect guests to login
// -----------------------------
router.get('/read', (req, res) => {
  const loggedIn = Boolean(
    (req.session && req.session.user) || req.user || req.authUser
  );

  if (!loggedIn) {
    const next = encodeURIComponent(req.originalUrl || '/read');
    return res.redirect(`/login?next=${next}`);
  }

  const provider = isStr(req.query.provider) ? req.query.provider : '';
  const id = isStr(req.query.id) ? req.query.id : '';
  return res.render('read', { provider, id });
});

// -----------------------------
// Static pages
// -----------------------------
router.get('/about', (_req, res) => res.render('about', {}));
router.get('/contact', (_req, res) => res.render('contact', {}));
router.get('/privacy', (_req, res) => res.render('privacy', {}));
router.get('/terms',   (_req, res) => res.render('terms', {}));

// -----------------------------
// Minimal search (fixes 500: provide `q`)
// -----------------------------
router.get('/search', (req, res) => {
  const q = isStr(req.query.q) ? req.query.q : '';
  return res.render('search', { q, results: [] });
});

module.exports = router;
