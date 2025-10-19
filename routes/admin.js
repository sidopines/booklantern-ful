// routes/admin.js — Admin dashboard + subroutes (no jsonwebtoken)
const express = require('express');
const router = express.Router();

const supabase    = require('../supabaseAdmin');       // service-role client (or null)
const ensureAdmin = require('../utils/adminGate');     // header/secret/email gate (no jwt)

// Gate all admin routes
router.use(ensureAdmin);

// Admin dashboard with counts (safe even if Supabase is null)
router.get('/', async (req, res) => {
  let usersCount = 0, booksCount = 0, videosCount = 0, genresCount = 0;

  if (supabase) {
    try {
      const [u, b, v, g] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('curated_books').select('id', { count: 'exact', head: true }),
        supabase.from('admin_videos').select('id', { count: 'exact', head: true }),
        supabase.from('video_genres').select('id', { count: 'exact', head: true }),
      ]);
      usersCount  = u?.count ?? 0;
      booksCount  = b?.count ?? 0;
      videosCount = v?.count ?? 0;
      genresCount = g?.count ?? 0;
    } catch (e) {
      console.warn('[admin] dashboard counts failed:', e.message || e);
    }
  }

  try {
    res.render('admin/index', {
      counts: { usersCount, booksCount, videosCount, genresCount }
    });
  } catch (e) {
    console.error('[admin] render index failed:', e);
    // Minimal fallback HTML if your admin/index.ejs is missing
    res.status(200).send(
      `<h1>Admin</h1>
       <ul>
         <li>Users: ${usersCount}</li>
         <li>Books: ${booksCount}</li>
         <li>Videos: ${videosCount}</li>
         <li>Genres: ${genresCount}</li>
       </ul>
       <p>
        <a href="/admin/books">Manage Books</a> ·
        <a href="/admin/videos">Manage Videos</a> ·
        <a href="/admin/video-genres">Manage Video Genres</a> ·
        <a href="/admin/users">Open Users</a>
       </p>`
    );
  }
});

// Sub-sections
router.use('/books',        require('./admin-books'));
router.use('/videos',       require('./admin-videos'));
router.use('/video-genres', require('./admin-video-genres'));
router.use('/users',        require('./admin-users'));

module.exports = router;
