// routes/admin-video-genres.js — simple CRUD for video_genres (renders EJS)
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');
const ensureAdmin = require('../utils/adminGate');

// admins only
router.use(ensureAdmin);

// Helper to load genres (optionally with usage counts)
async function fetchGenres() {
  // Basic list
  const { data, error } = await supabase
    .from('video_genres')
    .select('id, name')
    .order('name', { ascending: true });
  if (error) throw error;

  // If you later add a junction table, compute usage here.
  // For now, return 0 usage so the view renders cleanly.
  return (data || []).map(g => ({ ...g, usage: g.usage ?? 0 }));
}

// GET /admin/genres — list + form (render EJS)
router.get('/', async (_req, res) => {
  if (!supabase) {
    return res.status(503).render('admin/video-genres', {
      ok: false,
      err: 'Supabase is not configured.',
      genres: [],
    });
  }
  try {
    const genres = await fetchGenres();
    res.status(200).render('admin/video-genres', { ok: true, err: '', genres });
  } catch (e) {
    console.error('[admin] load genres failed:', e);
    res.status(500).render('admin/video-genres', { ok: false, err: 'Failed to load genres.', genres: [] });
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
    const { error } = await supabase.from('video_genres').delete().eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('[admin] delete genre failed:', e);
  }
  return res.redirect(303, '/admin/genres');
});

module.exports = router;
