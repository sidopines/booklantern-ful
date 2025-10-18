// routes/admin-books.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const categories = require('../config/categories');

// Secure Supabase admin client (server-side)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware — only allow Admin API token
router.use((req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// List books
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('curated_books')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.render('admin/books', { books: data || [], ok: false, err: null });
  } catch (err) {
    console.error('[admin-books:list]', err);
    res.render('admin/books', { books: [], ok: false, err: err.message });
  }
});

// Add new book
router.post('/', async (req, res) => {
  try {
    const { title, author, coverImage, sourceUrl, description, category } = req.body;

    if (!title || !sourceUrl) throw new Error('Missing title or source URL.');
    const cat = category && categories.includes(category)
      ? category
      : 'trending';

    const { error } = await supabase.from('curated_books').insert([
      {
        title,
        author: author || null,
        cover_image: coverImage || null,
        source_url: sourceUrl,
        category: cat,
      },
    ]);

    if (error) throw error;
    res.render('admin/books', { books: [], ok: true, err: null });
  } catch (err) {
    console.error('[admin-books:add]', err);
    res.render('admin/books', { books: [], ok: false, err: err.message });
  }
});

// Delete a book
router.post('/:id/delete', async (req, res) => {
  try {
    const id = req.params.id;
    const { error } = await supabase.from('curated_books').delete().eq('id', id);
    if (error) throw error;
    res.redirect('/admin/books');
  } catch (err) {
    console.error('[admin-books:delete]', err);
    res.redirect('/admin/books');
  }
});

module.exports = router;
