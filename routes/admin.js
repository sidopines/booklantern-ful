// routes/admin.js — Admin dashboard + users stub (to avoid 404)
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin');       // service-role client (or null)
const ensureAdmin = require('../utils/adminGate');  // JWT / X-Admin-Token gate

// Gate all admin routes
router.use(ensureAdmin);

// Admin dashboard
router.get('/', async (req, res) => {
  // Defaults so view renders even if Supabase is not configured
  let usersCount = 0, booksCount = 0, videosCount = 0, genresCount = 0;

  if (supabase) {
    try {
      const [u, b, v, g] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('curated_books').select('id', { count: 'exact', head: true }),
        supabase.from('admin_videos').select('id', { count: 'exact', head: true }),
        supabase.from('video_genres').select('id', { count: 'exact', head: true }),
      ]);
      usersCount  = u.count ?? 0;
      booksCount  = b.count ?? 0;
      videosCount = v.count ?? 0;
      genresCount = g.count ?? 0;
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
    // Minimal fallback if your admin/index.ejs is missing
    res.status(200).send(
      `<h1>Admin</h1>
       <ul>
         <li>Users: ${usersCount}</li>
         <li>Books: ${booksCount}</li>
         <li>Videos: ${videosCount}</li>
         <li>Genres: ${genresCount}</li>
       </ul>
       <p><a href="/admin/books">Manage Books</a> · <a href="/admin/videos">Manage Videos</a> · <a href="/admin/genres">Manage Genres</a> · <a href="/admin/users">Open Users</a></p>`
    );
  }
});

// --- Users stub to avoid 404s from the dashboard button ---
router.get('/users', async (req, res) => {
  // Optional: let you search by email/name later. For now, it’s a simple placeholder.
  try {
    // If you DO have a users view, this will render it.
    return res.render('admin/users', { query: (req.query.q || '').trim() });
  } catch {
    // Safe fallback HTML if the view doesn't exist yet.
    return res
      .status(200)
      .send(
        `<h1>Users</h1>
         <p>This is a placeholder so the button doesn’t 404.</p>
         <p>We can wire full search/toggle-admin here later.</p>
         <p><a href="/admin">← Back to Admin</a></p>`
      );
  }
});

module.exports = router;
