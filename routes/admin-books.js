// routes/admin-books.js — service-role writes for curated_books
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');            // service-role client (or null)
const ensureAdmin = require('../utils/adminGate');       // JWT/X-Admin-Token gate
const categoriesCfg = (() => {
  try { return require('../config/categories'); } catch { return []; }
})();

// Only admins beyond this point
router.use(ensureAdmin);

// GET /admin/books — form + list
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.status(503).render('admin/books', {
      ok: false,
      err: 'Supabase is not configured on the server.',
      books: [],
      categories: categoriesCfg.length ? categoriesCfg : ['trending','philosophy','history','science'],
    });
  }

  try {
    const { data: books = [], error } = await supabase
      .from('curated_books')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('admin/books', {
      ok: Boolean(req.query.ok),
      err: req.query.err ? 'Operation failed.' : '',
      books,
      categories: categoriesCfg.length ? categoriesCfg : ['trending','philosophy','history','science'],
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    res.render('admin/books', {
      ok: false,
      err: 'Failed to load books.',
      books: [],
      categories: categoriesCfg.length ? categoriesCfg : ['trending','philosophy','history','science'],
    });
  }
});

// POST /admin/books — create a curated book
router.post('/', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/books?err=1');

  const title      = String(req.body.title || '').trim();
  const author     = String(req.body.author || '').trim();
  const coverImage = String(req.body.coverImage || '').trim();
  const sourceUrl  = String(req.body.sourceUrl || '').trim();
  const category   = String(req.body.category || '').trim().toLowerCase();

  if (!title || !sourceUrl || !category) {
    return res.redirect(303, '/admin/books?err=1');
  }

  try {
    const { error } = await supabase.from('curated_books').insert([{
      title,
      author: author || null,
      cover_image: coverImage || null,
      source_url: sourceUrl,
      category,
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
