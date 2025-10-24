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

// Small helper for messages via querystring
function messagesFromQuery(q) {
  const msg = {};
  if (q.ok)  msg.success = 'Saved.';
  if (q.err) msg.error   = decodeURIComponent(q.err);
  return msg;
}

// GET /admin/books — form + list
router.get('/books', async (req, res, next) => {
  try {
    // genres for the dropdown
    const { data: genres, error: gErr } = await sb
      .from('book_genres')
      .select('slug,name,homepage_row')
      .order('homepage_row', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });

    if (gErr) {
      console.error('[admin] load books: genres query failed:', gErr);
      // still render page with banner
      return res.status(500).render('admin-books', {
        ...messagesFromQuery({ err: gErr.message }),
        genres: [],
        books: [],
        pageTitle: 'Admin • Books',
      });
    }

    // list curated books with joined genre name (via FK curated_books.genre_slug -> book_genres.slug)
    const { data: books, error: bErr } = await sb
      .from('curated_books')
      .select('id,title,author,cover,source_url,provider,provider_id,genre_slug,created_at,book_genres(name)')
      .order('created_at', { ascending: false });

    if (bErr) {
      console.error('[admin] load books: books query failed:', bErr);
      return res.status(500).render('admin-books', {
        ...messagesFromQuery({ err: bErr.message }),
        genres,
        books: [],
        pageTitle: 'Admin • Books',
      });
    }

    res.render('admin-books', {
      ...messagesFromQuery(req.query),
      genres,
      books,
      pageTitle: 'Admin • Books',
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    next(e);
  }
});

// POST /admin/books — add one curated book
router.post('/books', async (req, res) => {
  try {
    const {
      title,
      author,
      genre_slug, // dropdown value
      cover,
      source_url,
      provider,
      provider_id,
    } = req.body;

    if (!title || !genre_slug) {
      const msg = encodeURIComponent('Title and Genre/Shelf are required.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    const insertRow = {
      title: title?.trim(),
      author: author?.trim() || null,
      genre_slug: genre_slug?.trim(),
      cover: cover?.trim() || null,
      source_url: source_url?.trim() || null,
      provider: (provider?.trim() || null),
      provider_id: (provider_id?.toString().trim() || null),
    };

    const { error } = await sb.from('curated_books').insert(insertRow);
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
