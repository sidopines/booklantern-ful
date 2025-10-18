// routes/watch.js (optional separate router; not required if routes/index.js handles /watch)
const express = require('express');
const router = express.Router();

let supabaseAdmin = null;
try { supabaseAdmin = require('../supabaseAdmin'); } catch { supabaseAdmin = null; }

router.get('/', async (_req, res) => {
  let videos = [];
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('videos')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(48);
      if (!error && Array.isArray(data)) {
        videos = data.map(v => ({
          title: v.title || 'Untitled video',
          url: v.url || '#',
          thumb: v.thumb || v.thumbnail || null,
          slug: v.slug || null,
          video_id: v.video_id || null,
          description: v.description || null,
        }));
      }
    } catch (e) {}
  }
  res.render('watch', { videos });
});

// Detail (if you keep watch-show.ejs)
router.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '');
  let video = null;
  if (supabaseAdmin && slug) {
    const { data } = await supabaseAdmin.from('videos').select('*').eq('slug', slug).maybeSingle();
    if (data) {
      video = {
        title: data.title || 'Video',
        videoId: data.video_id || extractYouTubeId(data.url || '') || '',
        description: data.description || '',
      };
    }
  }
  res.render('watch-show', { video });
});

function extractYouTubeId(u) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    if (url.pathname.startsWith('/embed/')) return url.pathname.split('/embed/')[1];
  } catch {}
  return '';
}

module.exports = router;
