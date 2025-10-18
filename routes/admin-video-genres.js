// routes/admin-video-genres.js
// Admin CRUD for video genres (uses service-role Supabase)
// Writes: video_genres; Reads: video_genres, video_genres_map (for usage counts)

const express = require('express');
const router = express.Router();

let sb = null;
try {
  sb = require('../supabaseAdmin'); // exports service-role client or null
} catch {
  sb = null;
}

// Optional header-based guard (useful if admin gate not wired yet).
// If ADMIN_API_TOKEN is set, require it via X-Admin-Token; else, allow (assume upstream gate).
function requireAdminHeader(req, res) {
  const configured = process.env.ADMIN_API_TOKEN || '';
  if (!configured) return true; // no token configured => skip guard
  const presented = req.get('X-Admin-Token') || '';
  if (presented && presented === configured) return true;
  res.status(403).send('Forbidden');
  return false;
}

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// GET /admin/genres  — list all genres + usage counts
router.get('/', async (req, res) => {
  try {
    if (!sb) {
      return res.status(503).render('admin/video-genres', {
        ok: false,
        err: 'Supabase is not configured.',
        genres: [],
      });
    }

    // genres
    const { data: genres, error: gErr } = await sb
      .from('video_genres')
      .select('id,name')
      .order('name', { ascending: true });

    if (gErr) throw gErr;

    // usage counts from map
    const { data: maps, error: mErr } = await sb
      .from('video_genres_map')
      .select('genre_id');
    if (mErr) throw mErr;

    const counts = {};
    (Array.isArray(maps) ? maps : []).forEach((r) => {
      counts[r.genre_id] = (counts[r.genre_id] || 0) + 1;
    });

    const list = (Array.isArray(genres) ? genres : []).map((g) => ({
      id: g.id,
      name: g.name,
      usage: counts[g.id] || 0,
    }));

    return res.render('admin/video-genres', {
      ok: true,
      err: '',
      genres: list,
    });
  } catch (e) {
    console.error('[admin-video-genres] list failed:', e?.message || e);
    return res.render('admin/video-genres', {
      ok: false,
      err: 'Failed to load genres.',
      genres: [],
    });
  }
});

// POST /admin/genres  — create new genre
router.post('/', async (req, res) => {
  if (!requireAdminHeader(req, res)) return;
  try {
    if (!sb) return res.status(503).send('Supabase not configured');
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).send('Name required');

    const { error } = await sb.from('video_genres').insert({ name });
    if (error) throw error;
    return res.redirect('/admin/genres');
  } catch (e) {
    console.error('[admin-video-genres] create failed:', e?.message || e);
    return res.status(500).send('Create failed');
  }
});

// POST /admin/genres/:id/rename  — rename genre
router.post('/:id/rename', async (req, res) => {
  if (!requireAdminHeader(req, res)) return;
  try {
    if (!sb) return res.status(503).send('Supabase not configured');
    const id = String(req.params.id || '').trim();
    const name = String(req.body.name || '').trim();
    if (!id || !name) return res.status(400).send('Invalid input');

    const { error } = await sb.from('video_genres').update({ name }).eq('id', id);
    if (error) throw error;
    return res.redirect('/admin/genres');
  } catch (e) {
    console.error('[admin-video-genres] rename failed:', e?.message || e);
    return res.status(500).send('Rename failed');
  }
});

// POST /admin/genres/:id/delete  — delete genre (maps cascade)
router.post('/:id/delete', async (req, res) => {
  if (!requireAdminHeader(req, res)) return;
  try {
    if (!sb) return res.status(503).send('Supabase not configured');
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).send('Invalid id');

    // Deleting the genre will cascade to video_genres_map (schema has ON DELETE CASCADE)
    const { error } = await sb.from('video_genres').delete().eq('id', id);
    if (error) throw error;
    return res.redirect('/admin/genres');
  } catch (e) {
    console.error('[admin-video-genres] delete failed:', e?.message || e);
    return res.status(500).send('Delete failed');
  }
});

module.exports = router;
