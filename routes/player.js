// routes/player.js — safe, fallback-first player
const express = require('express');
const router = express.Router();

let sb = null;
try { sb = require('../supabaseAdmin'); } catch { sb = null; }

// ---------------- YouTube helpers ----------------
function youTubeIdFrom(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1);
    if (host.endsWith('youtube.com')) {
      if (u.pathname.startsWith('/watch')) return u.searchParams.get('v') || '';
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/').pop() || '';
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/').pop() || '';
      const m = u.pathname.match(/\/(live)\/([^/?#]+)/);
      if (m) return m[2] || '';
    }
  } catch { /* ignore */ }
  return '';
}
function toEmbedUrl(rawUrl) {
  const id = youTubeIdFrom(rawUrl || '');
  // nocookie avoids Safari ITP / 3rd-party cookie issues in Codespaces
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
}

// ---------------- Data (optional) ----------------
async function getVideoById(id) {
  if (!sb) return null;
  const { data, error } = await sb
    .from('admin_videos')
    .select('id,title,url,channel,thumb,created_at') // no description
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.warn('[player] fetch failed:', error.message);
    return null;
  }
  return data || null;
}

// ---------------- Route ----------------
router.get('/player/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/watch');

  try {
    // 1) Always accept explicit URL from query (fallback-first)
    const qp = req.query || {};
    const qpUrl = typeof qp.u === 'string' ? qp.u : '';
    const qpRow = qpUrl
      ? {
          id,
          title: (typeof qp.t === 'string' && qp.t) || 'Video',
          url: qpUrl,
          channel: (typeof qp.ch === 'string' && qp.ch) || '',
          thumb: (typeof qp.th === 'string' && qp.th) || '',
          created_at: null,
        }
      : null;

    // 2) If no query fallback, try DB (optional)
    const row = qpRow || (await getVideoById(id));

    if (!row || !row.url) {
      return res.status(404).render('404', { pageTitle: 'Video not found' });
    }

    const title = row.title || 'Untitled video';
    const embedUrl = toEmbedUrl(row.url);
    const isEmbeddable = Boolean(embedUrl);

    return res.render('player', {
      title,
      pageTitle: title,
      channel: row.channel || '',
      thumb: row.thumb || null,
      url: row.url || '',
      embedUrl,
      isEmbeddable,
      createdAt: row.created_at || null,
    });
  } catch (e) {
    console.error('[player] render failed:', e && e.stack ? e.stack : e);
    return res
      .status(500)
      .render('error', { pageTitle: 'Error', message: 'Unable to load the video right now.' });
  }
});

module.exports = router;
