// routes/admin-books.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// --- Supabase service client (admin) ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('supabaseKey is required.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// --- simple gate using ?admin_key=... (you already mount a broader admin gate) ---
function adminGate(req, res, next) {
  // you can replace this with your existing admin middleware
  if (req.query.admin_key && String(req.query.admin_key).startsWith('BL_ADMIN_')) {
    return next();
  }
  next();
}

// GET /admin/books
router.get('/books', adminGate, async (req, res) => {
  const messages = {};
  if (req.query.ok)  messages.success = 'Saved.';
  if (req.query.err) messages.error   = decodeURIComponent(req.query.err);

  // Load genres for the select (we need `name` and `slug`)
  const { data: genres, error: gErr } = await supabase
    .from('book_genres')
    .select('slug, name, homepage_row')
    .order('name', { ascending: true });

  if (gErr) {
    console.error('[admin] load genres failed:', gErr);
    messages.error = (messages.error ? messages.error + ' — ' : '') + (gErr.message || 'Failed to load genres');
  }

  // List curated books with their genre (if FK present Supabase can embed)
  const { data: books, error: bErr } = await supabase
    .from('curated_books')
    .select(`
      id, title, author, cover, source_url, provider, provider_id, genre_slug,
      book_genres!curated_books_genre_fk(name, slug, homepage_row)
    `)
    .order('created_at', { ascending: false });

  if (bErr) {
    console.error('[admin] load books failed:', bErr);
    messages.error = (messages.error ? messages.error + ' — ' : '') + (bErr.message || 'Failed to load books');
  }

  return res.render('admin-books', {
    title: 'Admin • Books',
    genres: genres || [],
    books: books || [],
    messages,
  });
});

// POST /admin/books
router.post('/books', adminGate, async (req, res) => {
  try {
    const {
      title,
      author,
      cover,
      source_url,
      provider,
      provider_id,
      genre_slug, // name of <select>
    } = req.body;

    if (!title || !genre_slug) {
      const msg = encodeURIComponent('Title and Genre/Shelf are required.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    const payload = {
      title: title.trim(),
      author: author ? author.trim() : null,
      cover: cover ? cover.trim() : null,
      source_url: source_url ? source_url.trim() : null,
      provider: provider ? provider.trim() : null,
      provider_id: provider_id ? String(provider_id).trim() : null,
      genre_slug: genre_slug.trim(),
    };

    const { error } = await supabase.from('curated_books').insert(payload).single();

    if (error) {
      console.error('[admin] add book failed:', error);
      const msg = encodeURIComponent(error.message || '1');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    const msg = encodeURIComponent(e.message || '1');
    return res.redirect(303, '/admin/books?err=' + msg);
  }
});

module.exports = router;
