// routes/admin-books.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// --- Supabase admin client ---
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
    updated: q.updated ? 'Updated.' : undefined,
  };
}

function normalizeBookRow(r) {
  return {
    id: r.id,
    title: r.title,
    author: r.author,
    cover: r.cover,
    source_url: r.source_url,
    provider: r.provider,
    provider_id: r.provider_id,
    genre_slug: r.genre_slug,
    category: (r.book_genres && r.book_genres.name)
      ? r.book_genres.name
      : (r.genre_slug || ''),
    created_at: r.created_at
  };
}

// GET /admin/books — add form + list
router.get('/books', async (req, res, next) => {
  try {
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

    const books = (rows || []).map(normalizeBookRow);

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

// GET /admin/books/:id — edit page
router.get('/books/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/admin/books');

  try {
    const [{ data: genres, error: gErr }, { data: row, error: bErr }] = await Promise.all([
      sb.from('book_genres')
        .select('slug,name,homepage_row')
        .order('homepage_row', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true }),
      sb.from('curated_books')
        .select('id,title,author,cover,source_url,provider,provider_id,genre_slug')
        .eq('id', id)
        .maybeSingle()
    ]);

    if (gErr) {
      console.error('[admin] edit: genres failed:', gErr);
      return res.redirect('/admin/books?err=' + encodeURIComponent(gErr.message));
    }
    if (bErr || !row) {
      const msg = bErr ? bErr.message : 'Book not found.';
      console.error('[admin] edit: load book failed:', msg);
      return res.redirect('/admin/books?err=' + encodeURIComponent(msg));
    }

    return res.render('admin/book-edit', {
      messages: messagesFromQuery(req.query),
      categories: genres || [],
      book: row
    });
  } catch (e) {
    console.error('[admin] edit page failed:', e);
    return res.redirect('/admin/books?err=' + encodeURIComponent(e.message || 'Edit failed.'));
  }
});

// POST /admin/books — add one curated book
router.post('/books', async (req, res) => {
  try {
    const {
      title,
      author,
      category,      // genre slug
      coverImage,
      sourceUrl,
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

// POST /admin/books/update — update a curated book
router.post('/books/update', async (req, res) => {
  try {
    const id = String(req.body.id || '').trim();
    if (!id) return res.redirect(303, '/admin/books?err=' + encodeURIComponent('Missing ID.'));

    const {
      title,
      author,
      category,      // genre slug
      coverImage,
      sourceUrl,
      provider,
      provider_id
    } = req.body;

    const updateRow = {
      title: (title || '').trim(),
      author: (author || '').trim() || null,
      genre_slug: (category || '').trim(),
      cover: (coverImage || '').trim() || null,
      source_url: (sourceUrl || '').trim() || null,
      provider: (provider || '').trim() || null,
      provider_id: ((provider_id ?? '') + '').trim() || null,
    };

    const { error } = await sb
      .from('curated_books')
      .update(updateRow)
      .eq('id', id);

    if (error) {
      console.error('[admin] update book failed:', error);
      const msg = encodeURIComponent(error.message || 'Update failed.');
      return res.redirect(303, `/admin/books/${id}?err=` + msg);
    }

    return res.redirect(303, '/admin/books?updated=1');
  } catch (e) {
    console.error('[admin] update book failed:', e);
    const msg = encodeURIComponent(e.message || 'Update failed.');
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
