// routes/admin-books.js — Admin: Books (CommonJS)

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

// --- Supabase admin (lazy) ---
function getSupabaseAdmin() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.supabaseUrl ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.supabaseKey || // some prior code used this
    process.env.SUPABASE_ANON_KEY; // last resort

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function encode(s) {
  try { return encodeURIComponent(String(s)); } catch { return '1'; }
}
function decode(s) {
  try { return decodeURIComponent(String(s)); } catch { return ''; }
}

// Validate category against the DB (genres.slug) to satisfy curated_books_category_chk
async function normalizeCategory(sb, incoming) {
  const raw = (incoming || '').trim().toLowerCase();
  if (!raw) return null;

  const { data: rows, error } = await sb
    .from('genres')
    .select('slug')
    .ilike('slug', raw)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return rows ? rows.slug : null;
}

/* GET /admin/books  ------------------------------------------------------- */
router.get('/books', async (req, res) => {
  const sb = getSupabaseAdmin();
  const messages = {};
  if (req.query.ok)  messages.success = 'Saved.';
  if (req.query.err) messages.error   = decode(req.query.err);

  if (!sb) {
    // Render page with a clear banner but do NOT crash
    return res.render('admin-books', {
      messages,
      books: [],
      genres: [],
      envError: 'Supabase URL/Key missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    });
  }

  try {
    const [{ data: books, error: e1 }, { data: genres, error: e2 }] = await Promise.all([
      sb.from('curated_books').select('*').order('created_at', { ascending: false }),
      sb.from('genres').select('slug,name').order('name', { ascending: true })
    ]);

    if (e1) throw e1;
    if (e2) throw e2;

    return res.render('admin-books', {
      messages,
      books: books || [],
      genres: genres || [],
      envError: null
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    messages.error = e.message || 'Failed to load books.';
    return res.render('admin-books', {
      messages,
      books: [],
      genres: [],
      envError: null
    });
  }
});

/* POST /admin/books  ------------------------------------------------------ */
router.post('/books', async (req, res) => {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const msg = encode('Supabase is not configured on the server.');
    return res.redirect(303, '/admin/books?err=' + msg);
  }

  try {
    // Expect fields from your form
    const {
      title,
      author,
      cover,        // cover image url
      source_url,   // catalog page url
      file_url,     // direct epub/pdf url (optional)
      category,     // expected to match a genres.slug (check constraint)
    } = req.body;

    if (!title || !cover || !source_url) {
      throw new Error('Title, Cover URL, and Source URL are required.');
    }

    const cat = await normalizeCategory(sb, category);
    if (!cat) {
      // This prevents the 23514 check constraint error
      throw new Error(
        `Invalid genre "${category}". Add it under Admin → Genres first, or choose an existing one.`
      );
    }

    const payload = {
      id: cryptoRandomId(),
      title: String(title).trim(),
      author: (author || '').trim() || null,
      cover: String(cover).trim(),
      source_url: String(source_url).trim(),
      file_url: (file_url || '').trim() || null,
      category: cat, // must match the DB CHECK / enum
    };

    const { error } = await sb.from('curated_books').insert(payload);
    if (error) throw error;

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    const msg = encode(e.message || '1');
    return res.redirect(303, '/admin/books?err=' + msg);
  }
});

/* Small helper for IDs when you’re not using DB default uuid() */
function cryptoRandomId() {
  // Avoid needing crypto.randomUUID in older Node by a tiny fallback
  try {
    return require('crypto').randomUUID();
  } catch {
    return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

module.exports = router;
