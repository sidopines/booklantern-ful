const express = require('express');
const router = express.Router();
const Video = require('../models/Video');

// Admin Dashboard - show all videos
router.get('/', async (req, res) => {
  const videos = await Video.find().sort({ createdAt: -1 });
  res.render('admin', { videos });
});

// Handle adding a video
router.post('/videos', async (req, res) => {
  const { title, genre, youtubeUrl, thumbnail, description } = req.body;
  try {
    await Video.create({ title, genre, youtubeUrl, thumbnail, description });
    res.redirect('/admin');
  } catch (error) {
    console.error('Error adding video:', error);
    res.status(500).send('Server Error');
  }
});

// Handle deleting a video
router.delete('/videos/:id', async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (error) {
    console.error('Error deleting video:', error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
