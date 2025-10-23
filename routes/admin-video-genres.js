// routes/admin-video-genres.js — simple CRUD for video_genres using EJS view
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');
const ensureAdmin = require('../utils/adminGate');

// admins only
router.use(ensureAdmin);

// Helper to fetch genres with usage counts
async function fetchGenresWithUsage() {
  const genres = [];
  if (!supabase) return genres;

  // Get all genres
  const { data: gData, error: gErr } = await supabase
    .from('video_genres')
    .select('id,name')
    .order('name', { ascending: true });
  if (gErr || !Array.isArray(gData)) return genres;

  // Count usage per genre via mapping table
  const { data: mData, error: mErr } = await supabase
    .from('video_genres_map')
    .select('genre_id');
  const counts = {};
  if (!mErr && Array.isArray(mData)) {
    for (const row of mData) {
      counts[row.genre_id] = (counts[row.genre_id] || 0) + 1;
    }
  }

  for (const g of gData) {
    genres.push({ id: g.id, name: g.name, usage: counts[g.id] || 0 });
  }
  return genres;
}

// GET /admin/genres — list + form
router.get('/', async (_req, res) => {
  if (!supabase) {
    return res
      .status(503)
      .render('admin/video-genres', { ok: false, err: 'Supabase is not configured.', genres: [] });
  }
  try {
    const genres = await fetchGenresWithUsage();
    return res.render('admin/video-genres', { ok: true, err: '', genres });
  } catch (e) {
    console.error('[admin] load genres failed:', e);
    return res
      .status(500)
      .render('admin/video-genres', { ok: false, err: 'Failed to load genres.', genres: [] });
  }
});

// POST /admin/genres — create
router.post('/', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/genres');
  const name = String(req.body.name || '').trim();
  if (!name) return res.redirect(303, '/admin/genres');
  try {
    const { error } = await supabase
      .from('video_genres')
      .upsert([{ name }], { onConflict: 'name' });
    if (error) throw error;
  } catch (e) {
    console.error('[admin] add genre failed:', e);
  }
  return res.redirect(303, '/admin/genres');
});

// POST /admin/genres/:id/rename
router.post('/:id/rename', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/genres');
  const id = String(req.params.id || '').trim();
  const name = String(req.body.name || '').trim();
  if (!id || !name) return res.redirect(303, '/admin/genres');
  try {
    const { error } = await supabase
      .from('video_genres')
      .update({ name })
      .eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('[admin] rename genre failed:', e);
  }
  return res.redirect(303, '/admin/genres');
});

// POST /admin/genres/:id/delete
router.post('/:id/delete', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/genres');
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect(303, '/admin/genres');
  try {
    // Remove mappings first to avoid FK issues (if any)
    await supabase.from('video_genres_map').delete().eq('genre_id', id);
    const { error } = await supabase.from('video_genres').delete().eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('[admin] delete genre failed:', e);
  }
  return res.redirect(303, '/admin/genres');
});

module.exports = router;
