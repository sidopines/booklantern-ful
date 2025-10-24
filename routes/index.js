// routes/index.js — public site pages; always pass safe locals to views
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role, may be null

// Helpers
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

/** Build a homepage card object with a gated Read link (provider/provider_id ➜ /read) */
function toHomeCard(row, isAuthed) {
  const provider = row.provider || null;
  const pid = row.provider_id || null;

  const directRead =
    provider && pid
      ? `/read?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(pid)}`
      : '/read';

  const readUrl = isAuthed ? directRead : `/login?next=${encodeURIComponent(directRead)}`;

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    cover: row.cover || row.cover_image || null,
    cover_image: row.cover_image || row.cover || null,
    provider,
    provider_id: pid,
    readUrl
  };
}

/** Build a /read staff-pick card (curated_books ➜ internal reader /reader/:id) */
function toReaderCard(row, isAuthed) {
  const directReader = `/reader/${encodeURIComponent(row.id)}`;
  const readUrl = isAuthed ? directReader : `/login?next=${encodeURIComponent(directReader)}`;

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    cover: row.cover || null,
    cover_image: row.cover || null,
    readUrl
  };
}

// -----------------------------
// Homepage
// -----------------------------
router.get('/', async (req, res) => {
  const desiredSlugs = ['trending', 'philosophy', 'history', 'science', 'biographies', 'religion', 'classics'];
  const isAuthed = Boolean((req.session && req.session.user) || req.user || req.authUser);

  let shelvesList = [];

  if (supabase) {
    try {
      const { data = [] } = await supabase
        .from('video_and_curated_books_catalog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

      const grouped = new Map();
      for (const r of data) {
        const slug = r.genre_slug || 'misc';
        if (!grouped.has(slug)) grouped.set(slug, []);
        grouped.get(slug).push(r);
      }

      shelvesList = desiredSlugs
        .filter((slug) => grouped.has(slug))
        .map((slug) => {
          const rows = grouped.get(slug).slice(0, 12);
          const label = rows[0]?.genre_name || (slug.charAt(0).toUpperCase() + slug.slice(1));
          return {
            key: slug,
            label,
            items: rows.map((r) => toHomeCard(r, isAuthed))
          };
        });

      if (!shelvesList.length && data.length) {
        shelvesList = [{
          key: 'featured',
          label: 'Featured',
          items: data.slice(0, 12).map((r) => toHomeCard(r, isAuthed))
        }];
      }
    } catch (e) {
      console.error('[home] fetch catalog failed:', e);
      shelvesList = [];
    }
  }

  return res.render('index', { shelvesList, shelvesData: {} });
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
// Read (reader shell) — show reader pane if params, plus Staff picks grid
// Only the Read buttons are gated; no global redirects.
// -----------------------------
router.get('/read', async (req, res) => {
  const provider = isStr(req.query.provider) ? req.query.provider : '';
  const id = isStr(req.query.id) ? req.query.id : '';
  const isAuthed = Boolean((req.session && req.session.user) || req.user || req.authUser);

  let staffPicks = [];
  if (supabase) {
    try {
      // Pull recent curated books; feel free to adjust filter/order.
      const { data = [] } = await supabase
        .from('curated_books')
        .select('id,title,author,cover,created_at')
        .order('created_at', { ascending: false })
        .limit(12);

      staffPicks = data.map((r) => toReaderCard(r, isAuthed));
    } catch (e) {
      console.error('[read] staff picks load failed:', e);
      staffPicks = [];
    }
  }

  return res.render('read', { provider, id, staffPicks });
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
