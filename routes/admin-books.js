// routes/admin-books.js — service-role writes to curated_books
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');
const ensureAdmin = require('../utils/adminGate');
const CATEGORIES = (() => {
  try { return require('../config/categories'); }
  catch { return ['trending', 'philosophy', 'history', 'science']; }
})();

router.use(ensureAdmin);

// GET form + list
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.render('admin/books', {
      ok: false,
      err: 'Supabase is not configured.',
      books: [],
      categories: CATEGORIES
    });
  }

  try {
    const { data: books = [], error } = await supabase
      .from('curated_books')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('admin/books', {
      ok: !!req.query.ok,
      err: req.query.err ? 'Operation failed.' : '',
      books,
      categories: CATEGORIES
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    res.render('admin/books', {
      ok: false, err: 'Failed to load.', books: [], categories: CATEGORIES
    });
  }
});

// POST create
router.post('/', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/books?err=1');

  const title       = String(req.body.title || '').trim();
  const author      = String(req.body.author || '').trim();
  const cover_image = String(req.body.coverImage || '').trim();
  const source_url  = String(req.body.sourceUrl || '').trim();
  const category    = String(req.body.category || '').trim().toLowerCase();

  if (!title || !source_url || !CATEGORIES.includes(category)) {
    return res.redirect(303, '/admin/books?err=1');
  }

  try {
    const { error } = await supabase.from('curated_books').insert([{
      title,
      author: author || null,
      cover_image: cover_image || null,
      source_url,
      category
    }]);
    if (error) throw error;

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    return res.redirect(303, '/admin/books?err=1');
  }
});

// POST delete
router.post('/:id/delete', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/books?err=1');
  const id = String(req.params.id || '').trim();
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
