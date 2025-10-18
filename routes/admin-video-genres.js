// routes/admin-video-genres.js
const express = require('express');
const router = express.Router();

let supabase = null;
try {
  supabase = require('../supabaseAdmin'); // service-role client
} catch {
  supabase = null;
}

function mustHaveSupabase(res) {
  if (!supabase) {
    res.status(503).send('Admin disabled: Supabase not configured.');
    return false;
  }
  return true;
}

// List all genres + counts
router.get('/', async (req, res) => {
  if (!mustHaveSupabase(res)) return;

  const { data: genres, error: gErr } = await supabase
    .from('video_genres')
    .select('id,name')
    .order('name', { ascending: true });
  if (gErr)
    return res.status(500).render('admin/video-genres', {
      err: gErr.message,
      genres: [],
      counts: {},
    });

  const { data: maps } = await supabase
    .from('video_genres_map')
    .select('genre_id');
  const counts = {};
  (maps || []).forEach((m) => {
    counts[m.genre_id] = (counts[m.genre_id] || 0) + 1;
  });

  res.render('admin/video-genres', { err: '', genres, counts });
});

// Create new
router.post('/', async (req, res) => {
  if (!mustHaveSupabase(res)) return;
  const name = String(req.body.name || '').trim();
  if (!name) return res.redirect('/admin/genres');

  await supabase.from('video_genres').insert({ name });
  res.redirect('/admin/genres');
});

// Delete
router.post('/:id/delete', async (req, res) => {
  if (!mustHaveSupabase(res)) return;
  const id = String(req.params.id || '');
  if (!id) return res.redirect('/admin/genres');

  await supabase.from('video_genres_map').delete().eq('genre_id', id);
  await supabase.from('video_genres').delete().eq('id', id);
  res.redirect('/admin/genres');
});

module.exports = router;
