// routes/admin-genres.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// GET /admin/genres
router.get('/genres', async (req, res) => {
  const messages = {};
  if (req.query.ok) messages.success = 'Saved.';
  if (req.query.err) messages.error = decodeURIComponent(req.query.err);

  try {
    const { data: genres, error } = await supabase
      .from('book_genres')
      .select('id,slug,label')
      .order('label', { ascending: true });

    if (error) throw error;

    res.render('admin-genres', { title: 'Admin • Book Genres', messages, genres });
  } catch (e) {
    console.error('[admin] load genres failed:', e);
    res.render('admin-genres', { title: 'Admin • Book Genres', messages: { error: 'Failed to load genres.' }, genres: [] });
  }
});

// POST /admin/genres (create)
router.post('/genres', async (req, res) => {
  try {
    const { slug, label } = req.body;
    if (!slug || !label) throw new Error('Both slug and label are required.');
    const { error } = await supabase.from('book_genres').insert([{ slug: slug.trim(), label: label.trim() }]);
    if (error) throw error;
    res.redirect(303, '/admin/genres?ok=1');
  } catch (e) {
    console.error('[admin] add genre failed:', e);
    res.redirect(303, '/admin/genres?err=' + encodeURIComponent(e.message || 'Save failed.'));
  }
});

// POST /admin/genres/:id/delete
router.post('/genres/:id/delete', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('book_genres').delete().eq('id', id);
    if (error) throw error;
    res.redirect(303, '/admin/genres?ok=1');
  } catch (e) {
    console.error('[admin] delete genre failed:', e);
    res.redirect(303, '/admin/genres?err=' + encodeURIComponent(e.message || 'Delete failed.'));
  }
});

module.exports = router;
