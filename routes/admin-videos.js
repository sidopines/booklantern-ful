// routes/admin-videos.js — service-role writes, proper redirects, genre mapping
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // service-role client (or null)
const ensureAdmin = require('../utils/adminGate'); // header/secret/email gate

// Only admins beyond this point
router.use(ensureAdmin);

// GET /admin/videos — form + list
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.status(503).render('admin/videos', {
      csrfToken: '',
      messages: { error: 'Supabase is not configured.' },
      videos: [],
      genres: []
    });
  }

  try {
    const [{ data: videos = [], error: vErr }, { data: genres = [], error: gErr }] = await Promise.all([
      supabase.from('admin_videos').select('*').order('created_at', { ascending: false }),
      supabase.from('video_genres').select('*').order('name', { ascending: true })
    ]);

    if (vErr) throw vErr;
    if (gErr) throw gErr;

    return res.render('admin/videos', {
      csrfToken: '',
      messages: {
        success: req.query.ok ? 'Saved.' : '',
        error: req.query.err ? 'Operation failed.' : ''
      },
      videos,
      genres
    });
  } catch (e) {
    console.error('[admin] load videos failed:', e);
    return res.render('admin/videos', {
      csrfToken: '',
      messages: { error: 'Failed to load videos.' },
      videos: [],
      genres: []
    });
  }
});

// POST /admin/videos — create video and map genres
router.post('/', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/videos?err=1');

  const title    = String(req.body.title || '').trim();
  const url      = String(req.body.url || '').trim();
  const channel  = String(req.body.channel || '').trim();
  const thumb    = String(req.body.thumbnail || '').trim();
  const selected = Array.isArray(req.body.genres) ? req.body.genres : [];
  const newCSV   = String(req.body.newGenres || '').trim();

  if (!title || !url) return res.redirect(303, '/admin/videos?err=1');

  try {
    // 1) Upsert any new genre names
    const newNames = newCSV ? newCSV.split(',').map(s => s.trim()).filter(Boolean) : [];
    let newIds = [];
    if (newNames.length) {
      const { data: upserted, error: gErr } = await supabase
        .from('video_genres')
        .upsert(newNames.map(n => ({ name: n })), { onConflict: 'name' })
        .select();
      if (gErr) throw gErr;
      newIds = (upserted || []).map(g => g.id);
    }

    // 2) Insert the video
    const { data: created, error: vErr } = await supabase
      .from('admin_videos')
      .insert([{ title, url, channel: channel || null, thumb: thumb || null }])
      .select()
      .single();
    if (vErr) throw vErr;

    // 3) Map all genres (existing selections + newly created)
    const allGenreIds = [...selected.filter(Boolean), ...newIds];
    if (created && created.id && allGenreIds.length) {
      const rows = allGenreIds.map(genre_id => ({ video_id: created.id, genre_id }));
      const { error: mErr } = await supabase.from('video_genres_map').insert(rows);
      if (mErr) console.warn('[admin] map genres warning:', mErr.message || mErr);
    }

    return res.redirect(303, '/admin/videos?ok=1');
  } catch (e) {
    console.error('[admin] add video failed:', e);
    return res.redirect(303, '/admin/videos?err=1');
  }
});

// POST /admin/videos/delete — delete by id
router.post('/delete', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/videos?err=1');
  const id = String(req.body.id || '').trim();
  if (!id) return res.redirect(303, '/admin/videos?err=1');

  try {
    const { error } = await supabase.from('admin_videos').delete().eq('id', id);
    if (error) throw error;
    return res.redirect(303, '/admin/videos?ok=1');
  } catch (e) {
    console.error('[admin] delete video failed:', e);
    return res.redirect(303, '/admin/videos?err=1');
  }
});

module.exports = router;
