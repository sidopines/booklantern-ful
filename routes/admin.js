// routes/admin.js — FINAL (Supabase + Admin UI pages + simple CRUD)
const express = require('express');
const router = express.Router();

// Reuse a tiny helper that returns a Supabase server client (service role)
// Create this file if you don’t already have it; contents are below.
let supabase;
try {
  supabase = require('../supabaseAdmin'); // exports client or null
} catch {
  supabase = null;
}

// ---------- Simple guard (owner-only UI) ----------
// If ADMIN_UI_TOKEN is set, require it as a query (?key=...) for GET pages
// and as a hidden field in POST forms. (Lightweight; you can harden later.)
const REQ_KEY = (req) => (req.query.key || req.body.key || '').trim();
function guard(req, res) {
  const token = process.env.ADMIN_UI_TOKEN || '';
  if (!token) return true; // no guard configured
  if (REQ_KEY(req) && REQ_KEY(req) === token) return true;
  res.status(403).send('Admin UI is locked. Add ?key=YOUR_TOKEN to the URL (and keep it in your bookmarks).');
  return false;
}

// ---------- Helpers ----------
function notConfigured(res) {
  return res
    .status(503)
    .send('Supabase is not configured on the server (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
}

async function countOf(table) {
  if (!supabase) return 0;
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) return 0;
  return count || 0;
}

async function getAllVideos() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('videos')
    .select(
      `
      id, title, url, channel, thumbnail, created_at,
      video_genre_map ( video_genres ( id, name ) )
      `
    )
    .order('created_at', { ascending: false });
  if (error) return [];
  // flatten genres
  return (data || []).map((v) => ({
    ...v,
    genres: (v.video_genre_map || [])
      .map((x) => x && x.video_genres && x.video_genres.name)
      .filter(Boolean),
  }));
}

async function getAllGenres() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('video_genres').select('id,name').order('name');
  return error ? [] : data;
}

async function upsertGenresByNames(names = []) {
  if (!supabase || !names.length) return [];
  // ensure lowercase + trim + unique
  const cleaned = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!cleaned.length) return [];

  // Upsert (unique by name); fetch ids
  const { data: inserted, error } = await supabase
    .from('video_genres')
    .upsert(cleaned.map((name) => ({ name })), { onConflict: 'name' })
    .select();
  if (error) throw error;
  return inserted || [];
}

async function setVideoGenres(videoId, genreIds = []) {
  if (!supabase) return;
  // clear existing
  await supabase.from('video_genre_map').delete().eq('video_id', videoId);
  // add new
  if (genreIds.length) {
    await supabase
      .from('video_genre_map')
      .insert(genreIds.map((gid) => ({ video_id: videoId, genre_id: gid })));
  }
}

// -------------------------------------------------
// Admin Home (Stats + launcher)
// GET /admin
// -------------------------------------------------
router.get('/', async (req, res) => {
  if (!guard(req, res)) return;
  if (!supabase) return notConfigured(res);

  const [users, books, videos, genres] = await Promise.all([
    countOf('auth.users').catch(() => 0), // won’t work via PostgREST; fallback to 0
    countOf('curated_books'),
    countOf('videos'),
    countOf('video_genres'),
  ]);

  res.render('admin/index', {
    stats: { users, books, videos, genres },
    ok: false,
    err: '',
  });
});

// -------------------------------------------------
// Videos UI
// GET  /admin/videos
// POST /admin/videos       (create)
// POST /admin/videos/delete (delete by id)
// -------------------------------------------------
router.get('/videos', async (req, res) => {
  if (!guard(req, res)) return;
  if (!supabase) return notConfigured(res);

  const [videos, genres] = await Promise.all([getAllVideos(), getAllGenres()]);
  res.render('admin/videos', {
    videos,
    genres,
    messages: {},
    csrfToken: '', // if you add CSRF later
  });
});

router.post('/videos', async (req, res) => {
  if (!guard(req, res)) return;
  if (!supabase) return notConfigured(res);

  try {
    const title = String(req.body.title || '').trim();
    const url = String(req.body.url || '').trim();
    const channel = String(req.body.channel || '').trim() || null;
    const thumbnail = String(req.body.thumbnail || '').trim() || null;

    // Genres can arrive as multi-select (array) or comma string
    let genresIn = req.body.genres || req.body.genre_names || [];
    if (typeof genresIn === 'string') {
      genresIn = genresIn.split(',').map((s) => s.trim());
    }
    const genres = Array.isArray(genresIn) ? genresIn.filter(Boolean) : [];

    if (!title || !url) throw new Error('Title and URL are required.');

    const { data: inserted, error } = await supabase
      .from('videos')
      .insert({ title, url, channel, thumbnail })
      .select()
      .single();
    if (error) throw error;

    // attach genres
    if (genres.length) {
      const upserted = await upsertGenresByNames(genres);
      const ids = (upserted || []).map((g) => g.id);
      await setVideoGenres(inserted.id, ids);
    }

    // redirect back with success
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/videos${key}&ok=1`);
  } catch (e) {
    console.error('[admin] add video failed:', e);
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/videos${key}&err=1`);
  }
});

router.post('/videos/delete', async (req, res) => {
  if (!guard(req, res)) return;
  if (!supabase) return notConfigured(res);

  const id = String(req.body.id || '').trim();
  if (!id) {
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/videos${key}&err=1`);
  }
  try {
    await supabase.from('video_genre_map').delete().eq('video_id', id);
    await supabase.from('videos').delete().eq('id', id);
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/videos${key}&ok=1`);
  } catch (e) {
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/videos${key}&err=1`);
  }
});

// -------------------------------------------------
// Books UI (curated)
// GET  /admin/books
// POST /admin/books                (create)
// POST /admin/books/:id/delete     (delete)
// -------------------------------------------------
router.get('/books', async (req, res) => {
  if (!guard(req, res)) return;
  if (!supabase) return notConfigured(res);

  const { data: books, error } = await supabase
    .from('curated_books')
    .select('*')
    .order('created_at', { ascending: false });

  res.render('admin/books', {
    ok: !error && req.query.ok,
    err: error ? error.message : req.query.err || '',
    books: books || [],
  });
});

router.post('/books', async (req, res) => {
  if (!guard(req, res)) return;
  if (!supabase) return notConfigured(res);

  try {
    const title = String(req.body.title || '').trim();
    const author = String(req.body.author || '').trim() || null;
    const coverImage = String(req.body.coverImage || '').trim() || null;
    const sourceUrl = String(req.body.sourceUrl || '').trim();
    const description = String(req.body.description || '').trim() || null;

    if (!title || !sourceUrl) throw new Error('Title and Source URL are required.');
    const { error } = await supabase
      .from('curated_books')
      .insert({ title, author, cover_image: coverImage, source_url: sourceUrl, description });
    if (error) throw error;

    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/books${key}&ok=1`);
  } catch (e) {
    console.error('[admin] add book failed:', e);
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/books${key}&err=${encodeURIComponent(e.message)}`);
  }
});

router.post('/books/:id/delete', async (req, res) => {
  if (!guard(req, res)) return;
  if (!supabase) return notConfigured(res);

  const id = String(req.params.id || '').trim();
  try {
    const { error } = await supabase.from('curated_books').delete().eq('id', id);
    if (error) throw error;
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/books${key}&ok=1`);
  } catch (e) {
    const key = REQ_KEY(req) ? `?key=${encodeURIComponent(REQ_KEY(req))}` : '';
    return res.redirect(`/admin/books${key}&err=${encodeURIComponent(e.message)}`);
  }
});

module.exports = router;
