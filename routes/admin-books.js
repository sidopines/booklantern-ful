// routes/admin-books.js — service-role writes for curated_books
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');            // service-role client (or null)
const ensureAdmin = require('../utils/adminGate');       // JWT/X-Admin-Token gate
const categoriesCfg = (() => {
  try { return require('../config/categories'); } catch { return []; }
})();

const CATEGORY_FALLBACK = ['trending','philosophy','history','science'];
const CATEGORIES = categoriesCfg.length ? categoriesCfg : CATEGORY_FALLBACK;

// Only admins beyond this point
router.use(ensureAdmin);

// Helper: build a source URL from provider + id (supports a few well-known providers)
function buildSourceUrl({ provider, providerId }) {
  const p = (provider || '').trim().toLowerCase();
  const id = (providerId || '').trim();
  if (!p || !id) return null;

  switch (p) {
    case 'gutenberg':
    case 'project gutenberg':
      return `https://www.gutenberg.org/ebooks/${id}`;
    case 'internetarchive':
    case 'archive':
    case 'ia':
      return `https://archive.org/details/${id}`;
    default:
      return null;
  }
}

// GET /admin/books — form + list
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.status(503).render('admin/books', {
      messages: { error: 'Supabase is not configured on the server.' },
      books: [],
      categories: CATEGORIES,
    });
  }

  try {
    // Be explicit about columns that actually exist on curated_books
    const { data: books = [], error } = await supabase
      .from('curated_books')
      .select('id, title, author, cover_image, source_url, category, created_at')
      .order('created_at', { ascending: false, nullsFirst: false });

    if (error) throw error;

    const messages = {};
    if (req.query.ok) messages.success = 'Saved.';
    if (req.query.err) messages.error = 'Operation failed. Check your inputs and try again.';

    res.render('admin/books', {
      messages,
      books,
      categories: CATEGORIES,
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    res.status(500).render('admin/books', {
      messages: { error: 'Failed to load books.' },
      books: [],
      categories: CATEGORIES,
    });
  }
});

// POST /admin/books — create a curated book
router.post('/', async (req, res) => {
  if (!supabase) return res.redirect(303, '/admin/books?err=1');

  const title       = String(req.body.title || '').trim();
  const author      = String(req.body.author || '').trim();
  const coverImage  = String(req.body.coverImage || '').trim();
  const sourceUrlIn = String(req.body.sourceUrl || '').trim();
  const provider    = String(req.body.provider || '').trim();
  const providerId  = String(req.body.provider_id || '').trim();
  const category    = String(req.body.category || '').trim().toLowerCase();

  // derive source URL if provider combo given
  const derived = buildSourceUrl({ provider, providerId });
  const sourceUrl = sourceUrlIn || derived || '';

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
