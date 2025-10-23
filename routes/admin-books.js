// routes/admin-books.js — service-role writes for curated_books
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');            // service-role client (or null)
const ensureAdmin = require('../utils/adminGate');       // JWT/X-Admin-Token gate

// Only admins beyond this point
router.use(ensureAdmin);

// GET /admin/books — form + list
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.status(503).render('admin/books', {
      books: [],
      messages: { error: 'Supabase is not configured on the server.' }
    });
  }

  try {
    const { data, error } = await supabase
      .from('curated_books')
      .select('id,title,author,provider,provider_id,cover,description,created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const msg =
      req.query.ok ? { success: 'Saved.' } :
      req.query.err ? { error: 'Operation failed.' } :
      null;

    res.render('admin/books', {
      books: Array.isArray(data) ? data : [],
      messages: msg
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    res.status(500).render('admin/books', {
      books: [],
      messages: { error: 'Failed to load books.' }
    });
  }
});

// POST /admin/books — create a curated book
router.post('/', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/books?err=1');

  const title       = String(req.body.title || '').trim();
  const author      = String(req.body.author || '').trim();
  const provider    = String(req.body.provider || '').trim();
  const provider_id = String(req.body.provider_id || '').trim();
  const cover       = String(req.body.cover || '').trim();
  const description = String(req.body.description || '').trim();

  if (!title) {
    return res.redirect(303, '/admin/books?err=1');
  }

  try {
    const { error } = await supabase.from('curated_books').insert([{
      title,
      author: author || null,
      provider: provider || null,
      provider_id: provider_id || null,
      cover: cover || null,
      description: description || null
    }]);

    if (error) throw error;
    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    return res.redirect(303, '/admin/books?err=1');
  }
});

// POST /admin/books/delete — delete by id
router.post('/delete', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/books?err=1');
  const id = String(req.body.id || '').trim();
  if (!id) return res.redirect(303, '/admin/books?err=1');

  try {
    const { error } = await supabase.from('curated_books').delete().eq('id', id);
    if (error) throw error;
    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] delete book failed:', e);
    return res.redirect(303, '/admin/books?err=1');
  }
});

module.exports = router;
