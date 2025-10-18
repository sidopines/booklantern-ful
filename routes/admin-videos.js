// routes/admin-videos.js
const express = require('express');
const router = express.Router();

let supabase = null;
try {
  supabase = require('../supabaseAdmin'); // service-role client
} catch {
  supabase = null;
}

function mustHaveSupabase(res) {
  if (!supabase) {
    res.status(503).send('Admin disabled: Supabase not configured.');
    return false;
  }
  return true;
}

// Helpers
async function listVideos() {
  const { data, error } = await supabase
    .from('admin_videos')
    .select('id,title,url,channel,thumb,created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}
async function listGenres() {
  const { data, error } = await supabase
    .from('video_genres')
    .select('id,name')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}
async function tagsForVideos(videoIds) {
  if (!videoIds.length) return {};
  const { data, error } = await supabase
    .from('video_genres_map')
    .select('video_id, genre_id');
  if (error) throw new Error(error.message);
  const byVid = {};
  (data || []).forEach((row) => {
    if (!byVid[row.video_id]) byVid[row.video_id] = new Set();
    byVid[row.video_id].add(row.genre_id);
  });
  return byVid;
}

// List
router.get('/', async (req, res) => {
  if (!mustHaveSupabase(res)) return;

  try {
    const [videos, genres] = await Promise.all([listVideos(), listGenres()]);
    const tags = await tagsForVideos(videos.map((v) => v.id));
    res.render('admin/videos', {
      csrfToken: '',
      messages: {},
      videos,
      genres,
      tags,
    });
  } catch (e) {
    console.error('[admin-videos] GET failed:', e.message);
    res.status(500).render('admin/videos', {
      csrfToken: '',
      messages: { error: e.message },
      videos: [],
      genres: [],
      tags: {},
    });
  }
});

// Create
router.post('/', async (req, res) => {
  if (!mustHaveSupabase(res)) return;

  const title = String(req.body.title || '').trim();
  const url = String(req.body.url || '').trim();
  const channel = String(req.body.channel || '').trim() || null;
  const thumbnail = String(req.body.thumbnail || '').trim() || null;
  const genres = []
    .concat(req.body.genres || [])
    .map((g) => String(g).trim())
    .filter(Boolean);

  if (!title || !url) {
    const [videos, allGenres] = await Promise.all([listVideos(), listGenres()]);
    const tags = await tagsForVideos(videos.map((v) => v.id));
    return res.status(400).render('admin/videos', {
      csrfToken: '',
      messages: { error: 'Title and URL are required.' },
      videos,
      genres: allGenres,
      tags,
    });
  }

  try {
    const { data, error } = await supabase
      .from('admin_videos')
      .insert({ title, url, channel, thumb: thumbnail })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    if (data && data.id && genres.length) {
      const rows = genres.map((gid) => ({ video_id: data.id, genre_id: gid }));
      const { error: mapErr } = await supabase.from('video_genres_map').insert(rows);
      if (mapErr) throw new Error(mapErr.message);
    }

    res.redirect('/admin/videos');
  } catch (e) {
    console.error('[admin-videos] create failed:', e.message);
    const [videos, allGenres] = await Promise.all([listVideos(), listGenres()]);
    const tags = await tagsForVideos(videos.map((v) => v.id));
    res.status(500).render('admin/videos', {
      csrfToken: '',
      messages: { error: e.message },
      videos,
      genres: allGenres,
      tags,
    });
  }
});

// Delete
router.post('/delete', async (req, res) => {
  if (!mustHaveSupabase(res)) return;
  const id = String(req.body.id || '').trim();
  if (!id) return res.redirect('/admin/videos');

  try {
    await supabase.from('video_genres_map').delete().eq('video_id', id);
    await supabase.from('admin_videos').delete().eq('id', id);
    res.redirect('/admin/videos');
  } catch (e) {
    console.error('[admin-videos] delete failed:', e.message);
    const [videos, allGenres] = await Promise.all([listVideos(), listGenres()]);
    const tags = await tagsForVideos(videos.map((v) => v.id));
    res.status(500).render('admin/videos', {
      csrfToken: '',
      messages: { error: e.message },
      videos,
      genres: allGenres,
      tags,
    });
  }
});

// Update tags
router.post('/:id/tags', async (req, res) => {
  if (!mustHaveSupabase(res)) return;
  const id = String(req.params.id || '').trim();
  if (!id) return res.redirect('/admin/videos');

  const selected = []
    .concat(req.body.genres || [])
    .map((g) => String(g).trim())
    .filter(Boolean);

  try {
    await supabase.from('video_genres_map').delete().eq('video_id', id);
    if (selected.length) {
      const rows = selected.map((gid) => ({ video_id: id, genre_id: gid }));
      await supabase.from('video_genres_map').insert(rows);
    }
    res.redirect('/admin/videos');
  } catch (e) {
    console.error('[admin-videos] tag update failed:', e.message);
    const [videos, allGenres] = await Promise.all([listVideos(), listGenres()]);
    const tags = await tagsForVideos(videos.map((v) => v.id));
    res.status(500).render('admin/videos', {
      csrfToken: '',
      messages: { error: e.message },
      videos,
      genres: allGenres,
      tags,
    });
  }
});

module.exports = router;
