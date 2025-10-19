// routes/admin-video-genres.js — simple CRUD for video_genres
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');
const ensureAdmin = require('../utils/adminGate');

// admins only
router.use(ensureAdmin);

// GET /admin/genres — list + form
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.status(503).render('admin/genres', {
      messages: { error: 'Supabase is not configured.' },
      genres: []
    });
  }
  try {
    const { data: genres = [], error } = await supabase
      .from('video_genres')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;

    // Render a minimal fallback page if you don't have views/admin/genres.ejs.
    // To keep “full and final”, we render a tiny HTML here to avoid 404.
    res.send(`<!DOCTYPE html><html><head>
      <meta charset="utf-8"><title>Admin • Genres</title>
      <style>
        body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}
        table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #e5e7eb}
        .row{display:flex;gap:.5rem;align-items:center}
        input,button{padding:.5rem .6rem}
        .muted{color:#667085}
      </style>
    </head><body>
      <h1>Manage Genres</h1>
      <form class="row" method="POST" action="/admin/genres">
        <input type="text" name="name" placeholder="New genre name" required/>
        <button type="submit">Add</button>
      </form>
      <p class="muted">Tip: After adding, use Admin → Videos to tag videos with these.</p>
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
      <p><a href="/admin">← Back to Admin</a></p>
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
    // will cascade remove mappings because video_genres_map has FK on delete cascade
    const { error } = await supabase.from('video_genres').delete().eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('[admin] delete genre failed:', e);
  }
  return res.redirect(303, '/admin/genres');
});

module.exports = router;
