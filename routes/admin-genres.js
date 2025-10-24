// routes/admin-genres.js
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.supabaseUrl;

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.supabaseKey;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Supabase URL/key missing for admin-genres router.');
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function messagesFromQuery(q) {
  const msg = {};
  if (q.ok)  msg.success = 'Saved.';
  if (q.err) msg.error   = decodeURIComponent(q.err);
  return msg;
}

// GET /admin/genres
router.get('/genres', async (req, res, next) => {
  try {
    const { data, error } = await sb
      .from('book_genres')
      .select('slug,name,homepage_row,created_at')
      .order('homepage_row', { ascending: true, nullsFirst: false })
      .order('name', { ascending: true });

    if (error) {
      console.error('[admin] load genres failed:', error);
      return res.status(500).render('admin-genres', {
        ...messagesFromQuery({ err: error.message }),
        genres: [],
        pageTitle: 'Admin • Genres',
      });
    }

    res.render('admin-genres', {
      ...messagesFromQuery(req.query),
      genres: data || [],
      pageTitle: 'Admin • Genres',
    });
  } catch (e) {
    console.error('[admin] load genres failed:', e);
    next(e);
  }
});

// POST /admin/genres — upsert by slug
router.post('/genres', async (req, res) => {
  try {
    const slug = (req.body.slug || '').trim();
    const name = (req.body.name || '').trim();
    const homepage_row = req.body.homepage_row ? Number(req.body.homepage_row) : null;

    if (!slug || !name) {
      const msg = encodeURIComponent('Both slug and name are required.');
      return res.redirect(303, '/admin/genres?err=' + msg);
    }

    const { error } = await sb
      .from('book_genres')
      .upsert({ slug, name, homepage_row }, { onConflict: 'slug' });

    if (error) {
      console.error('[admin] upsert genre failed:', error);
      const msg = encodeURIComponent(error.message || '1');
      return res.redirect(303, '/admin/genres?err=' + msg);
    }

    return res.redirect(303, '/admin/genres?ok=1');
  } catch (e) {
    console.error('[admin] upsert genre failed:', e);
    const msg = encodeURIComponent(e.message || '1');
    return res.redirect(303, '/admin/genres?err=' + msg);
  }
});

module.exports = router;
