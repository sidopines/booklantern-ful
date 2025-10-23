// routes/admin-books.js — Admin: Books (CommonJS, resilient to schema variance)

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

/* ---------- Supabase (lazy) ---------- */
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
    process.env.supabaseKey ||
    process.env.SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function enc(s) { try { return encodeURIComponent(String(s)); } catch { return '1'; } }
function dec(s) { try { return decodeURIComponent(String(s)); } catch { return ''; } }

/* ---------- Helpers ---------- */
async function fetchGenres(sb, localsCategories = []) {
  if (!sb) return [];

  // Try book_genres first (per your Render hint), then genres.
  const tables = ['book_genres', 'genres'];
  for (const t of tables) {
    const { data, error } = await sb.from(t).select('slug,name').order('name', { ascending: true });
    if (!error && Array.isArray(data)) return data;
    // If it failed because table missing (PGRST205), try next table name.
    if (error && error.code !== 'PGRST205') {
      // other errors -> bubble by throwing to caller
      throw error;
    }
  }

  // Fallback: use config/categories.js (res.locals.categories) if present
  if (Array.isArray(localsCategories) && localsCategories.length) {
    // map ['history','science'] -> [{slug:'history', name:'History'}, ...]
    return localsCategories.map(slug => ({
      slug: String(slug),
      name: String(slug).replace(/(^|-)([a-z])/g, (_, p1, c) => (p1 ? ' ' : '') + c.toUpperCase()).trim()
    }));
  }

  return [];
}

async function normalizeCategory(sb, incoming, localsCategories = []) {
  const raw = (incoming || '').trim().toLowerCase();
  if (!raw) return null;

  // check against fetched list so we don't rely on a specific table existing
  const list = await fetchGenres(sb, localsCategories);
  const hit = list.find(g => g.slug.toLowerCase() === raw);
  return hit ? hit.slug : null;
}

function randomId() {
  try { return require('crypto').randomUUID(); }
  catch { return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

/* ============================
   GET /admin/books
   ============================ */
router.get('/books', async (req, res) => {
  const sb = getSupabaseAdmin();
  const messages = {};
  if (req.query.ok)  messages.success = 'Saved.';
  if (req.query.err) messages.error   = dec(req.query.err);

  if (!sb) {
    return res.render('admin-books', {
      title: 'Admin • Books',
      messages,
      books: [],
      genres: [],
      envError: 'Supabase URL/Key missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    });
  }

  try {
    const [{ data: books, error: e1 }] = await Promise.all([
      sb.from('curated_books').select('*').order('created_at', { ascending: false })
    ]);
    if (e1) throw e1;

    const genres = await fetchGenres(sb, res.locals.categories);

    return res.render('admin-books', {
      title: 'Admin • Books',
      messages,
      books: books || [],
      genres,
      envError: null
    });
  } catch (e) {
    console.error('[admin] load books failed:', e);
    messages.error = e.message || 'Failed to load books.';
    // Render a soft-failed page (no crash)
    return res.render('admin-books', {
      title: 'Admin • Books',
      messages,
      books: [],
      genres: [],
      envError: null
    });
  }
});

/* ============================
   POST /admin/books
   ============================ */
router.post('/books', async (req, res) => {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return res.redirect(303, '/admin/books?err=' + enc('Supabase is not configured on the server.'));
  }

  try {
    const { title, author, cover, source_url, file_url, category } = req.body;
    if (!title || !cover || !source_url) {
      throw new Error('Title, Cover URL, and Source URL are required.');
    }

    const cat = await normalizeCategory(sb, category, res.locals.categories);
    if (!cat) {
      throw new Error(`Invalid genre "${category}". Add it in Admin → Genres or select an existing one.`);
    }

    const payload = {
      id: randomId(),
      title: String(title).trim(),
      author: (author || '').trim() || null,
      cover: String(cover).trim(),
      source_url: String(source_url).trim(),
      file_url: (file_url || '').trim() || null,
      category: cat
    };

    const { error } = await sb.from('curated_books').insert(payload);
    if (error) throw error;

    return res.redirect(303, '/admin/books?ok=1');
  } catch (e) {
    console.error('[admin] add book failed:', e);
    return res.redirect(303, '/admin/books?err=' + enc(e.message || '1'));
  }
});

module.exports = router;
