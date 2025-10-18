// routes/watch.js — Supabase-powered Watch page with optional genre filters
const express = require('express');
const router = express.Router();

// Optional Supabase server client (service role)
let sb = null;
try {
  sb = require('../supabaseAdmin'); // exports a client or null
} catch {
  sb = null;
}

// Helper: derive a thumbnail if missing and the URL is YouTube
function guessThumb(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    // YouTube watch or share links
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      let id = '';
      if (host === 'youtu.be') id = u.pathname.replace('/', '');
      else if (u.pathname.startsWith('/watch')) id = u.searchParams.get('v') || '';
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/').pop();
      if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
  } catch {}
  return null;
}

// Fetch all genres
async function getGenres() {
  if (!sb) return [];
  const { data, error } = await sb
    .from('video_genres')
    .select('id,name')
    .order('name', { ascending: true });
  if (error) {
    console.warn('[watch] getGenres failed:', error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

// Fetch videos; if genreId provided, filter by genre mapping table
async function getVideos({ genreId } = {}) {
  if (!sb) return [];

  let videoIds = null;
  if (genreId) {
    const { data: mapRows, error: mapErr } = await sb
      .from('video_genres_map')
      .select('video_id')
      .eq('genre_id', genreId);
    if (mapErr) {
      console.warn('[watch] map query failed:', mapErr.message);
      return [];
    }
    videoIds = (Array.isArray(mapRows) ? mapRows : []).map((r) => r.video_id);
    if (!videoIds.length) return [];
  }

  let query = sb
    .from('admin_videos')
    .select('id,title,url,channel,thumb,created_at')
    .order('created_at', { ascending: false });

  if (videoIds) {
    query = query.in('id', videoIds);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[watch] videos query failed:', error.message);
    return [];
  }

  // Normalize and fill thumbnails when missing
  return (Array.isArray(data) ? data : []).map((v) => {
    const thumb = v.thumb || guessThumb(v.url) || null;
    return {
      id: v.id,
      title: v.title || 'Untitled video',
      url: v.url || '#',
      channel: v.channel || '',
      thumb,
      created_at: v.created_at || null,
    };
  });
}

/**
 * GET /watch
 * Optional query: ?genre=<genre_id>
 */
router.get('/', async (req, res) => {
  try {
    const genres = await getGenres();
    const genre = String(req.query.genre || '').trim() || null;

    // Verify filter exists
    const activeGenre = genre && genres.find((g) => g.id === genre) ? genre : null;

    const videos = await getVideos({ genreId: activeGenre });

    return res.render('watch', {
      videos,
      genres,          // [{id, name}]
      activeGenre,     // current selected genre id or null
    });
  } catch (e) {
    console.error('[watch] render failed:', e);
    return res.render('watch', { videos: [], genres: [], activeGenre: null });
  }
});

module.exports = router;
