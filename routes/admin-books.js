// routes/admin-books.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// GET /admin/books
router.get('/books', async (req, res) => {
  const messages = {};
  if (req.query.ok) messages.success = 'Saved.';
  if (req.query.err) messages.error = decodeURIComponent(req.query.err);

  try {
    const [{ data: genres, error: gErr }, { data: books, error: bErr }] =
      await Promise.all([
        supabase.from('book_genres').select('slug,label').order('label', { ascending: true }),
        supabase.from('curated_books').select('*').order('created_at', { ascending: false })
      ]);

    if (gErr) throw gErr;
    if (bErr) throw bErr;

    return res.render('admin-books', {
      title: 'Admin • Books',
      messages,
      genres,
      books
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    messages.error = 'Failed to load books.';
    return res.status(200).render('admin-books', {
      title: 'Admin • Books',
      messages,
      genres: [],
      books: []
    });
  }
});

// POST /admin/books
router.post('/books', async (req, res) => {
  try {
    const {
      title,
      author,
      category,          // slug from book_genres
      cover,             // cover URL
      source_url,        // preferred/canonical link (can be .epub)
      provider,          // e.g. 'gutenberg'
      provider_id        // e.g. '1342'
    } = req.body;

    if (!title || !category) {
      throw new Error('Title and Genre/Shelf are required.');
    }

    // If no source_url is provided but Gutenberg is, try to set something sensible
    let finalSource = source_url && source_url.trim() ? source_url.trim() : null;
    if (!finalSource && provider === 'gutenberg' && provider_id) {
      // Basic canonical page (you can change to a direct .epub if you prefer)
      finalSource = `https://www.gutenberg.org/ebooks/${encodeURIComponent(provider_id)}`;
    }

    const { error: insErr } = await supabase.from('curated_books').insert([{
      title: title.trim(),
      author: author && author.trim() || null,
      category: category.trim(),
      cover: cover && cover.trim() || null,
      source_url: finalSource,
      provider: provider && provider.trim() || null,
      provider_id: provider_id && String(provider_id).trim() || null
    }]);

    if (insErr) throw insErr;

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    const msg = encodeURIComponent(e.message || 'Save failed.');
    return res.redirect(303, '/admin/books?err=' + msg);
  }
});

module.exports = router;
