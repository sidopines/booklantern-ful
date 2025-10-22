// routes/player.js
// Express route for /player/:id that loads a video from Supabase
// and guarantees a safe, embeddable iframe URL.

const express = require('express');
const router = express.Router();

// ---- Supabase client ----
// If you already have a central client (e.g., in lib/supabase.js), replace this require with yours:
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[player.js] Missing SUPABASE_URL / SUPABASE_ANON_KEY env vars.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Helper: turn a pasted video URL into an embeddable URL ----
function toEmbedUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');

    // YouTube: /watch?v=ID
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
      }
      // YouTube Shorts: /shorts/ID
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2];
        if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
      }
      // already /embed/ID
      if (u.pathname.startsWith('/embed/')) {
        return `https://www.youtube-nocookie.com${u.pathname}${u.search}`;
      }
    }

    // youtu.be/ID
    if (host === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      if (id) return `https://www.youtube-nocookie.com/embed/${id}`;
    }

    // Vimeo: vimeo.com/ID or player.vimeo.com/video/ID
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      const id = parts.pop();
      if (host === 'player.vimeo.com' && parts[0] === 'video' && id) {
        // already an embed form
        return u.toString();
      }
      if (id && /^\d+$/.test(id)) {
        return `https://player.vimeo.com/video/${id}`;
      }
    }

    return null; // unknown/unsupported host
  } catch {
    return null;
  }
}

// GET /player/:id
router.get('/player/:id', async (req, res) => {
  const { id } = req.params;

  // Adjust table/columns to your schema. Assumes a "videos" table with:
  // id (text/uuid), title (text), description (text), source_url (text), created_at, etc.
  const { data: video, error } = await supabase
    .from('videos')
    .select('id,title,description,source_url,url,link,created_at')
    .eq('id', id)
    .single();

  if (error || !video) {
    console.error('[player.js] Video fetch error:', error || 'not found');
    return res.status(404).render('errors/404', {
      message: 'Video not found',
    });
  }

  const rawUrl = video.source_url || video.url || video.link || null;
  const embedUrl = toEmbedUrl(rawUrl);

  // Pass through to view
  return res.render('player', {
    video,
    embedUrl,
    pageTitle: video.title ? `${video.title} • BookLantern` : 'Video • BookLantern',
  });
});

module.exports = router;
