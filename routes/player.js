// routes/player.js — fetch one video by id and render an embeddable player page
const express = require('express');
const router = express.Router();

// Supabase admin client (service role)
let sb = null;
try {
  sb = require('../supabaseAdmin'); // exports a client or null
} catch {
  sb = null;
}

// Extract a YouTube ID from a URL (watch/share/embed forms)
function youTubeIdFrom(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1);
    if (host.endsWith('youtube.com')) {
      if (u.pathname.startsWith('/watch')) return u.searchParams.get('v') || '';
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/').pop() || '';
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/').pop() || '';
    }
  } catch {
    // ignore
  }
  return '';
}

function toEmbedInfo(rawUrl) {
  const ytId = youTubeIdFrom(rawUrl || '');
  if (ytId) {
    return {
      platform: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${ytId}`,
    };
  }
  // Fallback: show nothing (or extend here for Vimeo, etc.)
  return { platform: 'unknown', embedUrl: '' };
}

async function getVideoById(id) {
  if (!sb) return null;
  const { data, error } = await sb
    .from('admin_videos')
    // IMPORTANT: use url (NOT link/description which don't exist)
    .select('id,title,url,channel,thumb,created_at')
    .eq('id', id)
    .single();

  if (error) {
    console.warn('[player] fetch failed:', error.message);
    return null;
  }
  return data || null;
}

// GET /player/:id
router.get('/player/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/watch');

  try {
    const row = await getVideoById(id);
    if (!row) {
      // Use your existing 404 view name
      return res.status(404).render('404');
    }

    const embed = toEmbedInfo(row.url);
    return res.render('player', {
      title: row.title || 'Untitled video',
      channel: row.channel || '',
      thumb: row.thumb || null,
      url: row.url || '',
      embedUrl: embed.embedUrl,   // for <iframe src="">
      isEmbeddable: !!embed.embedUrl,
      createdAt: row.created_at || null,
    });
  } catch (e) {
    console.error('[player] render failed:', e);
    return res.status(500).render('error', {
      message: 'Unable to load the video right now.',
    });
  }
});

module.exports = router;
