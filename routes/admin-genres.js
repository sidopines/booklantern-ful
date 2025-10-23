// routes/admin-genres.js — Admin: Genres (CommonJS)

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

function encode(s) {
  try { return encodeURIComponent(String(s)); } catch { return '1'; }
}
function decode(s) {
  try { return decodeURIComponent(String(s)); } catch { return ''; }
}

/* GET /admin/genres ------------------------------------------------------- */
router.get('/genres', async (req, res) => {
  const sb = getSupabaseAdmin();
  const messages = {};
  if (req.query.ok)  messages.success = 'Saved.';
  if (req.query.err) messages.error   = decode(req.query.err);

  if (!sb) {
    return res.render('admin-genres', {
      messages,
      rows: [],
      envError: 'Supabase URL/Key missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    });
  }

  try {
    const { data, error } = await sb.from('genres').select('slug,name').order('name');
    if (error) throw error;
    return res.render('admin-genres', {
      messages,
      rows: data || [],
      envError: null
    });
  } catch (e) {
    console.error('[admin] load genres failed:', e);
    messages.error = e.message || 'Failed to load genres.';
    return res.render('admin-genres', {
      messages,
      rows: [],
      envError: null
    });
  }
});

/* POST /admin/genres ------------------------------------------------------ */
router.post('/genres', async (req, res) => {
  const sb = getSupabaseAdmin();
  if (!sb) {
    const msg = encode('Supabase is not configured on the server.');
    return res.redirect(303, '/admin/genres?err=' + msg);
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

    const { error } = await sb.from('genres').insert({ slug, name });
    if (error) throw error;

    return res.redirect(303, '/admin/genres?ok=1');
  } catch (e) {
    console.error('[admin] add genre failed:', e);
    return res.redirect(303, '/admin/genres?err=' + encode(e.message || '1'));
  }
});

module.exports = router;
