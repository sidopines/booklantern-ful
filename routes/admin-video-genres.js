// routes/admin-video-genres.js — simple CRUD for video_genres
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');
const ensureAdmin = require('../utils/adminGate');

// admins only
router.use(ensureAdmin);

// GET /admin/genres — list + form
router.get('/', async (_req, res) => {
  if (!supabase) {
    return res.status(503).send('<p>Supabase is not configured.</p>');
  }
  try {
    const { data: genres = [], error } = await supabase
      .from('video_genres')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;

    res.send(`<!DOCTYPE html><html><head>
      <meta charset="utf-8"><title>Manage Video Genres • Admin</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}
        table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5e7eb}
        .row{display:flex;gap:.5rem;align-items:center}
        input,button{padding:.5rem .6rem}
        .muted{color:#667085}
        a.btn,button{border:1px solid #0000001a;border-radius:8px;background:#f6f7f9;cursor:pointer}
      </style>
    </head><body>
      <h1>Manage Video Genres</h1>
      <form class="row" method="POST" action="/admin/genres">
        <input type="text" name="name" placeholder="New genre name" required/>
        <button type="submit">Add</button>
      </form>
      <p class="muted">After adding, use <a href="/admin/videos">Admin → Videos</a> to tag videos.</p>
      <h2>Current Genres</h2>
      <table><thead><tr><th style="text-align:left">Name</th><th>Actions</th></tr></thead><tbody>
      ${genres.map(g => `
        <tr>
          <td>${g.name}</td>
          <td style="text-align:center">
            <form class="row" method="POST" action="/admin/genres/rename" style="display:inline">
              <input type="hidden" name="id" value="${g.id}">
              <input type="text" name="name" value="${g.name}" required>
              <button type="submit">Rename</button>
            </form>
            <form method="POST" action="/admin/genres/delete" style="display:inline;margin-left:6px" onsubmit="return confirm('Delete “${g.name}”?')">
              <input type="hidden" name="id" value="${g.id}">
              <button type="submit">Delete</button>
            </form>
          </td>
        </tr>`).join('')}
      </tbody></table>
      <p><a class="btn" href="/admin">← Back to Admin</a></p>
    </body></html>`);
  } catch (e) {
    console.error('[admin] load genres failed:', e);
    res.status(500).send('Failed to load genres.');
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

// POST /admin/genres/rename
router.post('/rename', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/genres');
  const id = String(req.body.id || '').trim();
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

// POST /admin/genres/delete
router.post('/delete', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/genres');
  const id = String(req.body.id || '').trim();
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
