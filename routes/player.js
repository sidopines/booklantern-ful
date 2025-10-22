// routes/player.js
// Express route for /player/:id that loads a video from Supabase
// and guarantees a safe, embeddable iframe URL (YouTube/Vimeo).

const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[player.js] Missing SUPABASE_URL / SUPABASE_ANON_KEY');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------- Embed helpers ----------------
function cleanHost(h) { return (h || '').replace(/^www\./, '').toLowerCase(); }

function ytId(raw) {
  try {
    const u = new URL(raw);
    const host = cleanHost(u.hostname);

    // youtu.be/<id>
    if (host === 'youtu.be') {
      const id = u.pathname.split('/')[1] || '';
      return id || null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      // /watch?v=<id>
      const v = u.searchParams.get('v');
      if (v) return v;

      // /shorts/<id>, /embed/<id>, /live/<id>
      const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?#]+)/);
      if (m && m[2]) return m[2];
    }

    // already on the privacy-enhanced domain
    if (host === 'youtube-nocookie.com') {
      const m = u.pathname.match(/\/embed\/([^/?#]+)/);
      if (m && m[1]) return m[1];
    }
  } catch (_) {}
  return null;
}

function vimeoId(raw) {
  try {
    const u = new URL(raw);
    const host = cleanHost(u.hostname);
    if (host === 'player.vimeo.com') {
      const m = u.pathname.match(/^\/video\/(\d+)/);
      if (m) return m[1];
    }
    if (host === 'vimeo.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      const id = parts.pop();
      if (id && /^\d+$/.test(id)) return id;
    }
  } catch (_) {}
  return null;
}

function toEmbedUrl(raw) {
  if (!raw) return null;

  const yid = ytId(raw);
  if (yid) {
    // modest branding; related off; playsinline for mobile
    const params = new URLSearchParams({
      rel: '0',
      modestbranding: '1',
      playsinline: '1',
      ref: 'booklantern'
    });
    return `https://www.youtube-nocookie.com/embed/${yid}?${params.toString()}`;
  }

  const vid = vimeoId(raw);
  if (vid) {
    return `https://player.vimeo.com/video/${vid}?byline=0&portrait=0&title=0`;
  }

  // Unknown host: no embed
  return null;
}

// ---------------- Data fetch (admin_videos first) ----------------
async function fetchVideoById(id) {
  // 1) admin_videos (this powers your Watch grid)
  let { data: av, error: avErr } = await supabase
    .from('admin_videos')
    .select('id,title,url,channel,thumb,created_at')
    .eq('id', id)
    .maybeSingle();

  if (!avErr && av) {
    return {
      id: av.id,
      title: av.title || 'Untitled video',
      description: null,
      url: av.url || null,
      source_url: null,
      link: null,
      channel: av.channel || '',
      thumb: av.thumb || null,
      created_at: av.created_at || null,
    };
  }

  // 2) legacy videos table (if any)
  const { data: v2, error: v2Err } = await supabase
    .from('videos')
    .select('id,title,description,url,source_url,link,created_at')
    .eq('id', id)
    .maybeSingle();

  if (!v2Err && v2) {
    return {
      id: v2.id,
      title: v2.title || 'Untitled video',
      description: v2.description || null,
      url: v2.url || null,
      source_url: v2.source_url || null,
      link: v2.link || null,
      channel: '',
      thumb: null,
      created_at: v2.created_at || null,
    };
  }

  throw avErr || v2Err || new Error('Not found');
}

// ---------------- Route ----------------
router.get('/player/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const video = await fetchVideoById(id);
    const rawUrl = video.source_url || video.url || video.link || null;
    const embedUrl = toEmbedUrl(rawUrl);

    return res.render('player', {
      video,
      embedUrl,
      rawUrl,
      pageTitle: video.title ? `${video.title} • BookLantern` : 'Video • BookLantern',
    });
  } catch (err) {
    console.error('[player.js] Video fetch error:', err?.message || err);
    return res.status(404).render('404');
  }
});

module.exports = router;
