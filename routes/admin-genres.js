// routes/admin-genres.js — Admin: Genres (works with book_genres OR genres)

const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

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

async function firstExistingTable(sb, candidates) {
  for (const t of candidates) {
    const { error } = await sb.from(t).select('slug').limit(1);
    if (!error || error.code === 'PGRST116') return t; // PGRST116 = no rows, table exists
    if (error && error.code !== 'PGRST205') throw error; // other errors -> surface
  }
  return null;
}

router.get('/genres', async (req, res) => {
  const sb = getSupabaseAdmin();
  const messages = {};
  if (req.query.ok)  messages.success = 'Saved.';
  if (req.query.err) messages.error   = dec(req.query.err);

  if (!sb) {
    return res.render('admin-genres', {
      title: 'Admin • Genres',
      messages,
      rows: [],
      envError: 'Supabase URL/Key missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    });
  }

  try {
    const table = await firstExistingTable(sb, ['book_genres', 'genres']);
    let rows = [];
    if (table) {
      const { data, error } = await sb.from(table).select('slug,name').order('name');
      if (error) throw error;
      rows = data || [];
    } else if (Array.isArray(res.locals.categories) && res.locals.categories.length) {
      rows = res.locals.categories.map(slug => ({
        slug: String(slug),
        name: String(slug).replace(/(^|-)([a-z])/g, (_, p1, c) => (p1 ? ' ' : '') + c.toUpperCase()).trim()
      }));
    }

    return res.render('admin-genres', {
      title: 'Admin • Genres',
      messages,
      rows,
      envError: null
    });
  } catch (e) {
    console.error('[admin] load genres failed:', e);
    messages.error = e.message || 'Failed to load genres.';
    return res.render('admin-genres', {
      title: 'Admin • Genres',
      messages,
      rows: [],
      envError: null
    });
  }
});

router.post('/genres', async (req, res) => {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return res.redirect(303, '/admin/genres?err=' + enc('Supabase is not configured on the server.'));
  }

  try {
    const name = (req.body.name || '').trim();
    let slug = (req.body.slug || '').trim().toLowerCase();
    if (!name) throw new Error('Name is required.');

    if (!slug) {
      slug = name.toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }

    const table = await firstExistingTable(sb, ['book_genres', 'genres']);
    if (!table) throw new Error('No genres table exists (book_genres or genres).');

    const { error } = await sb.from(table).insert({ slug, name });
    if (error) throw error;

    return res.redirect(303, '/admin/genres?ok=1');
  } catch (e) {
    console.error('[admin] add genre failed:', e);
    return res.redirect(303, '/admin/genres?err=' + enc(e.message || '1'));
  }
});

module.exports = router;
