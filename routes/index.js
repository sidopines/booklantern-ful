// routes/index.js — public site pages; always pass safe locals to views
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role, may be null
const { buildOpenUrl } = require('../utils/bookHelpers');

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

/** Build a homepage card object — always route through /open for reliable resolution */
function toHomeCard(row) {
  const provider = row.provider || null;
  const pid = row.provider_id || null;
  const cover = row.cover || row.cover_image || null;

  // Build a canonical /open URL using the shared helper
  const openUrl = buildOpenUrl({
    provider: provider || 'unknown',
    provider_id: pid || '',
    title: row.title || '',
    author: row.author || '',
    cover: cover || '',
    archive_id: row.archive_id || '',
    source_url: row.source_url || '',
    direct_url: row.direct_url || '',
    format: row.format || ''
  });

  // Fallback: search by title+author if /open URL can't be built
  const searchFallback = `/read?q=${encodeURIComponent([row.title, row.author].filter(Boolean).join(' '))}`;
  const readUrl = openUrl || searchFallback;

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    cover: cover,
    cover_image: cover,
    provider,
    provider_id: pid,
    readUrl
  };
}

/** Build a staff-pick card — route through /open, fallback to search */
function toReaderCard(row) {
  const title = row.title || '';
  const author = row.author || '';
  const cover = row.cover || null;

  // Try canonical /open URL first
  const openUrl = buildOpenUrl({
    provider: row.provider || 'unknown',
    provider_id: row.provider_id || '',
    title,
    author,
    cover: cover || '',
    archive_id: row.archive_id || '',
    source_url: row.source_url || '',
    direct_url: row.direct_url || '',
    format: row.format || ''
  });

  // Fallback: search by title+author
  const searchFallback = `/read?q=${encodeURIComponent([title, author].filter(Boolean).join(' '))}`;
  const readUrl = openUrl || searchFallback;

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    cover: cover,
    cover_image: cover,
    href: readUrl,
    readUrl
  };
}

// -----------------------------
// Homepage
// -----------------------------
router.get('/', async (req, res) => {
  const desiredSlugs = ['trending', 'philosophy', 'history', 'science', 'biographies', 'religion', 'classics'];

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
            items: rows.map((r) => toHomeCard(r))
          };
        });

      if (!shelvesList.length && data.length) {
        shelvesList = [{
          key: 'featured',
          label: 'Featured',
          items: data.slice(0, 12).map((r) => toHomeCard(r))
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
// Read (reader shell) — require subscriber
router.get('/read', require('../utils/gate').ensureSubscriber, async (req, res) => {
  let staffPicks = [];
  if (supabase) {
    try {
      // Pull recent curated books; include provider/provider_id for /open links
      const { data = [] } = await supabase
        .from('curated_books')
        .select('id,title,author,cover,provider,provider_id,archive_id,source_url,direct_url,format,created_at')
        .order('created_at', { ascending: false })
        .limit(12);

      staffPicks = (data || []).map((r) => toReaderCard(r));
    } catch (e) {
      console.error('[read] staff picks load failed:', e);
      staffPicks = [];
    }
  }

  return res.render('read', { staffPicks });
});

// -----------------------------
// Static pages
// -----------------------------
router.get('/about', (_req, res) => res.render('about', {}));
router.get('/contact', (_req, res) => res.render('contact', {}));
router.get('/privacy', (_req, res) => res.render('privacy', {}));
router.get('/terms',   (_req, res) => res.render('terms', {}));

module.exports = router;
