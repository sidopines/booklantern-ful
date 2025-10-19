// routes/admin.js — dashboard + users stub
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');
const ensureAdmin = require('../utils/adminGate');

// gate everything under /admin
router.use(ensureAdmin);

// Admin dashboard
router.get('/', async (req, res) => {
  // Best-effort counts; if Supabase missing, show zeros
  let counts = { users: 0, books: 0, videos: 0, genres: 0 };

  try {
    if (supabase) {
      const [{ count: books }, { count: videos }, { count: genres }] = await Promise.all([
        supabase.from('curated_books').select('*', { count: 'exact', head: true }),
        supabase.from('admin_videos').select('*', { count: 'exact', head: true }),
        supabase.from('video_genres').select('*', { count: 'exact', head: true })
      ]);
      counts.books = books || 0;
      counts.videos = videos || 0;
      counts.genres = genres || 0;
      // Users count is non-trivial via PostgREST; leave 0 or wire Auth Admin if desired
    }
  } catch (e) {
    console.warn('[admin] count fetch warning:', e.message || e);
  }

  res.render('admin/index', { counts });
});

// Minimal /admin/users to avoid 404 for now
router.get('/users', (_req, res) => {
  res.status(200).send(`
    <main style="max-width:800px;margin:40px auto;font-family:system-ui;line-height:1.5">
      <h1>Users</h1>
      <p>This page is coming soon. For now, manage users in Supabase Auth.</p>
      <p><a href="/admin">← Back to Admin</a></p>
    </main>
  `);
});

module.exports = router;
