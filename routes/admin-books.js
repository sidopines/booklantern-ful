// routes/admin-books.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// --- Supabase admin client (service role preferred, else SUPABASE_KEY/supabaseKey) ---
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.supabaseUrl;

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.supabaseKey;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Supabase URL/key missing for admin-books router.');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- helpers ---
function messagesFromQuery(q) {
  return {
    success: q.ok ? 'Saved.' : undefined,
    error: q.err ? decodeURIComponent(q.err) : undefined,
    deleted: q.deleted ? 'Deleted.' : undefined,
  };
}

// GET /admin/books — form + list
router.get('/books', async (req, res, next) => {
  try {
    // 1) genres for the dropdown
    const { data: genres, error: gErr } = await sb
      .from('book_genres')
      .select('slug,name,homepage_row')
      .order('homepage_row', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });

    if (gErr) {
      console.error('[admin] load books: genres query failed:', gErr);
      return res.status(500).render('admin/books', {
        messages: { error: gErr.message },
        categories: [],
        books: [],
      });
    }

    // 2) list curated books (left join the genre display name if FK exists)
    const { data: rows, error: bErr } = await sb
      .from('curated_books')
      .select('id,title,author,cover,source_url,provider,provider_id,genre_slug,created_at,book_genres(name)')
      .order('created_at', { ascending: false });

    if (bErr) {
      console.error('[admin] load books: books query failed:', bErr);
      return res.status(500).render('admin/books', {
        messages: { error: bErr.message },
        categories: genres || [],
        books: [],
      });
    }

    // normalize for the view: `category` is the pretty name if available, else slug
    const books = (rows || []).map((r) => ({
      id: r.id,
      title: r.title,
      author: r.author,
      cover: r.cover,
      source_url: r.source_url,
      provider: r.provider,
      provider_id: r.provider_id,
      genre_slug: r.genre_slug,
      category: (r.book_genres && r.book_genres.name) ? r.book_genres.name : (r.genre_slug || ''),
      created_at: r.created_at
    }));

    return res.render('admin/books', {
      messages: messagesFromQuery(req.query),
      categories: genres || [],
      books
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    next(e);
  }
});

// POST /admin/books — add one curated book
router.post('/books', async (req, res) => {
  try {
    // names match your form in views/admin/books.ejs
    const {
      title,
      author,
      category,      // <select name="category"> -> this is the genre slug
      coverImage,    // <input name="coverImage">
      sourceUrl,     // <input name="sourceUrl">
      provider,
      provider_id
    } = req.body;

    if (!title || !category) {
      const msg = encodeURIComponent('Title and Genre/Shelf are required.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    const insertRow = {
      title: (title || '').trim(),
      author: (author || '').trim() || null,
      genre_slug: (category || '').trim(),
      cover: (coverImage || '').trim() || null,
      source_url: (sourceUrl || '').trim() || null,
      provider: (provider || '').trim() || null,
      provider_id: ((provider_id ?? '') + '').trim() || null,
    };

    const { error } = await sb.from('curated_books').insert(insertRow);
    if (error) {
      console.error('[admin] add book failed:', error);
      const msg = encodeURIComponent(error.message || 'Insert failed.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    const msg = encodeURIComponent(e.message || 'Insert failed.');
    return res.redirect(303, '/admin/books?err=' + msg);
  }
});

// POST /admin/books/delete — delete one curated book
router.post('/books/delete', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.redirect(303, '/admin/books');

    const { error } = await sb.from('curated_books').delete().eq('id', id);
    if (error) {
      console.error('[admin] delete book failed:', error);
      const msg = encodeURIComponent(error.message || 'Delete failed.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }
    return res.redirect(303, '/admin/books?deleted=1');
  } catch (e) {
    console.error('[admin] delete book failed:', e);
    const msg = encodeURIComponent(e.message || 'Delete failed.');
    return res.redirect(303, '/admin/books?err=' + msg);
  }
});

module.exports = router;
