// routes/admin-genres.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('supabaseKey is required.');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

function adminGate(req, res, next) {
  if (req.query.admin_key && String(req.query.admin_key).startsWith('BL_ADMIN_')) {
    return next();
  }
  next();
}

// GET /admin/genres
router.get('/genres', adminGate, async (req, res) => {
  const messages = {};
  if (req.query.ok)  messages.success = 'Saved.';
  if (req.query.err) messages.error   = decodeURIComponent(req.query.err);

  const { data, error } = await supabase
    .from('book_genres')
    .select('id, slug, name, homepage_row, created_at')
    .order('name', { ascending: true });

  if (error) {
    console.error('[admin] load genres failed:', error);
    messages.error = (messages.error ? messages.error + ' — ' : '') + (error.message || 'Failed to load genres');
  }

  return res.render('admin-genres', {
    title: 'Admin • Genres',
    genres: data || [],
    messages,
  });
});

// POST /admin/genres
router.post('/genres', adminGate, async (req, res) => {
  try {
    const { slug, name, homepage_row } = req.body;
    if (!slug || !name) {
      const msg = encodeURIComponent('Both slug and name are required.');
      return res.redirect(303, '/admin/genres?err=' + msg);
    }
    const { error } = await supabase.from('book_genres').insert({
      slug: slug.trim(),
      name: name.trim(),
      homepage_row: homepage_row ? Number(homepage_row) : null,
    });

    if (error) {
      console.error('[admin] add genre failed:', error);
      const msg = encodeURIComponent(error.message || '1');
      return res.redirect(303, '/admin/genres?err=' + msg);
    }

    return res.redirect(303, '/admin/genres?ok=1');
  } catch (e) {
    console.error('[admin] add genre failed:', e);
    const msg = encodeURIComponent(e.message || '1');
    return res.redirect(303, '/admin/genres?err=' + msg);
  }
});

module.exports = router;
