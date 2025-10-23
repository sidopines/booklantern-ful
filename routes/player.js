// routes/player.js — fetch one video by id and render an embeddable player page
const express = require('express');
const router = express.Router();

let sb = null;
try { sb = require('../supabaseAdmin'); } catch { sb = null; }

// ---- YouTube helpers -------------------------------------------------------
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
  } catch {}
  return '';
}
function toEmbedUrl(rawUrl) {
  const id = youTubeIdFrom(rawUrl || '');
  return id ? `https://www.youtube.com/embed/${id}` : '';
}

// ---- Data ------------------------------------------------------------------
async function getVideoById(id) {
  if (!sb) return null;
  const { data, error } = await sb
    .from('admin_videos')
    // IMPORTANT: your table uses `url` (NOT `link`)
    .select('id,title,url,channel,thumb,created_at')
    .eq('id', id)
    .single();
  if (error) {
    console.warn('[player] fetch failed:', error.message);
    return null;
  }
  return data || null;
}

// ---- Route -----------------------------------------------------------------
router.get('/player/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/watch');

  try {
    const row = await getVideoById(id);
    if (!row) return res.status(404).render('404', { pageTitle: 'Video not found' });

    const embedUrl = toEmbedUrl(row.url);
    return res.render('player', {
      title: row.title || 'Untitled video',
      pageTitle: row.title || 'Video',
      channel: row.channel || '',
      thumb: row.thumb || null,
      url: row.url || '',
      embedUrl,
      isEmbeddable: !!embedUrl,
      createdAt: row.created_at || null,
    });
  } catch (e) {
    console.error('[player] render failed:', e);
    return res
      .status(500)
      .render('error', { pageTitle: 'Error', message: 'Unable to load the video right now.' });
  }
});

module.exports = router;
