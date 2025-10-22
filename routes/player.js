// routes/player.js
// Express route for /player/:id that loads a video from Supabase
// and guarantees a safe, embeddable iframe URL.

const express = require('express');
const router = express.Router();

// Use the same server Supabase client as admin/watch to avoid anon limitations
let sb = null;
try {
  sb = require('../supabaseAdmin'); // service role client
} catch {
  sb = null;
  console.warn('[player.js] supabaseAdmin not available; player route will fail.');
}

// ---- Helper: turn a pasted video URL into an embeddable URL ----
function toEmbedUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');

    // YouTube
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
      }
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2];
        if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
      }
      if (u.pathname.startsWith('/embed/')) {
        return `https://www.youtube-nocookie.com${u.pathname}${u.search}`;
      }
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }

    // Vimeo
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      const id = parts.pop();
      if (host === 'player.vimeo.com' && parts[0] === 'video' && id) {
        return u.toString();
      }
      if (id && /^\d+$/.test(id)) {
        return `https://player.vimeo.com/video/${id}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// GET /player/:id
router.get('/player/:id', async (req, res) => {
  if (!sb) return res.status(500).render('error');

  const { id } = req.params;

  // Use the same table/view the Watch grid uses so IDs match
  const { data: video, error } = await sb
    .from('admin_videos')
    .select('id,title,url,link,source_url,channel,thumb,created_at')
    .eq('id', id)
    .single();

  if (error || !video) {
    console.error('[player.js] Video fetch error:', error || 'not found');
    return res.status(404).render('errors/404', { message: 'Video not found' });
  }

  const rawUrl = video.source_url || video.url || video.link || null;
  const embedUrl = toEmbedUrl(rawUrl);

  return res.render('player', {
    video,
    embedUrl,
    pageTitle: video.title ? `${video.title} • BookLantern` : 'Video • BookLantern',
  });
});

module.exports = router;
