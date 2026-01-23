// routes/admin-books.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const categories = require('../config/categories');

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

// ----------------- helpers -----------------
function buildSourceUrl(provider, id) {
  if (!provider || !id) return null;
  const p = String(provider).toLowerCase();
  const s = String(id).trim();
  // If user pasted a full URL in "Provider ID" by mistake, normalize:
  if (/^https?:\/\//i.test(s)) return s;

  if (p === 'gutenberg' || p === 'pg') return `https://www.gutenberg.org/ebooks/${s}`;
  if (p === 'openlibrary' || p === 'ol') return `https://openlibrary.org/${s}`; // accepts works/OL...M etc.
  if (p === 'archive' || p === 'ia') return `https://archive.org/details/${s}`;
  if (p === 'loc') return `https://www.loc.gov/item/${s}`;
  return null;
}

function messagesFromQuery(q) {
  const msg = {};
  if (q.ok)  msg.success = 'Saved.';
  if (q.err) msg.error   = decodeURIComponent(q.err);
  return { messages: msg };
}

function normalizeId(req) {
  const raw = req.body?.id ?? req.query?.id ?? req.params?.id ?? '';
  if (Array.isArray(raw)) return String(raw[0] || '').trim();
  return String(raw || '').trim();
}

function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

// ----------------- GET /admin/books (add + list) -----------------
// Note: This router is mounted at /admin/books, so route is just '/'
router.get('/', async (req, res, next) => {
  try {
    const { data: genres, error: gErr } = await sb
      .from('book_genres')
      .select('slug,name,homepage_row')
      .order('homepage_row', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });

    if (gErr) {
      console.error('[admin] load books: genres query failed:', gErr);
      return res.status(500).render('admin/books', {
        ...messagesFromQuery({ err: gErr.message }),
        genres: [],
        books: [],
        pageTitle: 'Admin • Books',
      });
    }

    const { data: books, error: bErr } = await sb
      .from('curated_books')
      .select('id,title,author,cover,source_url,provider,provider_id,genre_slug,created_at,book_genres(name)')
      .order('created_at', { ascending: false });

    if (bErr) {
      console.error('[admin] load books: books query failed:', bErr);
      return res.status(500).render('admin/books', {
        ...messagesFromQuery({ err: bErr.message }),
        genres,
        books: [],
        pageTitle: 'Admin • Books',
      });
    }

    // Build shelves dropdown from categories config
    const shelves = categories.map(slug => ({
      value: slug,
      label: slug.charAt(0).toUpperCase() + slug.slice(1)
    }));

    res.render('admin/books', {
      ...messagesFromQuery(req.query),
      genres,
      books,
      shelves,
      pageTitle: 'Admin • Books',
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    next(e);
  }
});

// ----------------- POST /admin/books (create) -----------------
router.post('/', async (req, res) => {
  try {
    const {
      title,
      author,
      category,     // from the form field name="category"
      genre_slug,   // legacy support
      shelf,        // alternative field name
      genre,        // alternative field name
      cover,
      cover_url,    // alternative field name
      source_url: rawSourceUrl,
      provider,
      provider_id,
    } = req.body;

    // Normalize genre field (accept multiple field names)
    const genreSlug = (category || genre_slug || shelf || genre || '').trim();

    // Prefer explicit source_url; else build from provider+id
    let source_url = (rawSourceUrl && rawSourceUrl.trim()) || buildSourceUrl(provider, provider_id);

    // Normalize cover field
    const coverUrl = (cover || cover_url || '').trim() || null;

    // Basic validation
    if (!title || !author || !genreSlug) {
      const msg = encodeURIComponent('Title, Author, and Genre/Shelf are required.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    if (!source_url) {
      const msg = encodeURIComponent('Provide a Source URL or a Provider+ID.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    const insertRow = {
      title: title.trim(),
      author: author.trim(),
      genre_slug: genreSlug,
      cover: coverUrl,
      source_url: source_url,
      provider: (provider?.trim() || null),
      provider_id: (provider_id?.toString().trim() || null),
    };

    const { error } = await sb.from('curated_books').insert(insertRow);
    if (error) {
      console.error('[admin] add book failed:', error);
      const msg = encodeURIComponent(error.message || 'Failed to save book.');
      return res.redirect(303, '/admin/books?err=' + msg);
    }

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    const msg = encodeURIComponent(e.message || 'Unexpected error.');
    return res.redirect(303, '/admin/books?err=' + msg);
  }
});

// ----------------- POST /admin/books/delete -----------------
router.post('/delete', async (req, res) => {
  try {
    const id = normalizeId(req);
    if (!isUUID(id)) {
      return res.redirect(303, '/admin/books?err=' + encodeURIComponent('Invalid book id.'));
    }
    const { error } = await sb.from('curated_books').delete().eq('id', id);
    if (error) {
      console.error('[admin] delete book failed:', error);
      return res.redirect(303, '/admin/books?err=' + encodeURIComponent(error.message));
    }
    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] delete book failed:', e);
    return res.redirect(303, '/admin/books?err=' + encodeURIComponent(e.message || '1'));
  }
});

// ----------------- GET /admin/books/:id (edit page) -----------------
router.get('/:id', async (req, res) => {
  try {
    const id = normalizeId(req);
    if (!isUUID(id)) {
      return res.redirect(303, '/admin/books?err=' + encodeURIComponent('Invalid book id.'));
    }

    const [{ data: genres, error: gErr }, { data: book, error: bErr }] = await Promise.all([
      sb.from('book_genres').select('slug,name').order('name', { ascending: true }),
      sb.from('curated_books').select('*').eq('id', id).maybeSingle()
    ]);

    if (gErr) {
      console.error('[admin] edit: load genres failed:', gErr);
      return res.redirect(303, '/admin/books?err=' + encodeURIComponent(gErr.message));
    }
    if (bErr || !book) {
      const msg = bErr?.message || 'Book not found.';
      console.error('[admin] edit: load book failed:', msg);
      return res.redirect(303, '/admin/books?err=' + encodeURIComponent(msg));
    }

    return res.render('admin/book-edit', {
      ...messagesFromQuery(req.query),
      genres,
      book,
      pageTitle: 'Admin • Edit book'
    });
  } catch (e) {
    console.error('[admin] edit: load failed:', e);
    return res.redirect(303, '/admin/books?err=' + encodeURIComponent(e.message || '1'));
  }
});

// ----------------- POST /admin/books/update -----------------
router.post('/update', async (req, res) => {
  try {
    const id = normalizeId(req);
    if (!isUUID(id)) {
      return res.redirect(303, '/admin/books?err=' + encodeURIComponent('Invalid book id.'));
    }

    const payload = {
      title: (req.body.title ?? '').trim(),
      author: (req.body.author ?? '').trim() || null,
      genre_slug: (req.body.genre_slug ?? '').trim(),
      cover: (req.body.cover ?? '').trim() || null,
      source_url: (req.body.source_url ?? '').trim() || null,
      provider: (req.body.provider ?? '').trim() || null,
      provider_id: (req.body.provider_id ?? '').toString().trim() || null,
    };

    if (!payload.title || !payload.genre_slug) {
      return res.redirect(303, `/admin/books/${id}?err=` + encodeURIComponent('Title and Genre/Shelf are required.'));
    }

    const { error } = await sb.from('curated_books').update(payload).eq('id', id);
    if (error) {
      console.error('[admin] update book failed:', error);
      return res.redirect(303, `/admin/books/${id}?err=` + encodeURIComponent(error.message));
    }

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] update book failed:', e);
    return res.redirect(303, '/admin/books?err=' + encodeURIComponent(e.message || '1'));
  }
});

module.exports = router;
