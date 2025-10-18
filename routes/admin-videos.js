// routes/admin-videos.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Secure Supabase admin client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware — only allow Admin API token
router.use((req, res, next) => {
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(403).send('Forbidden');
  }
  next();
});

// List videos
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_videos')
      .select('*, video_genres_map(video_genres(name))')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.render('admin/videos', { videos: data || [], messages: {} });
  } catch (err) {
    console.error('[admin-videos:list]', err);
    res.render('admin/videos', { videos: [], messages: { error: err.message } });
  }
});

// Add video
router.post('/', async (req, res) => {
  try {
    const { title, url, channel, thumbnail } = req.body;
    if (!title || !url) throw new Error('Missing title or URL.');

    const { error } = await supabase.from('admin_videos').insert([
      {
        title,
        url,
        channel: channel || null,
        thumb: thumbnail || null,
      },
    ]);
    if (error) throw error;

    res.render('admin/videos', {
      videos: [],
      messages: { success: 'Video added successfully.' },
    });
  } catch (err) {
    console.error('[admin-videos:add]', err);
    res.render('admin/videos', {
      videos: [],
      messages: { error: err.message },
    });
  }
});

// Delete video
router.post('/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const { error } = await supabase.from('admin_videos').delete().eq('id', id);
    if (error) throw error;
    res.redirect('/admin/videos');
  } catch (err) {
    console.error('[admin-videos:delete]', err);
    res.redirect('/admin/videos');
  }
});

module.exports = router;
