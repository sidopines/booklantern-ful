// routes/bookRoutes.js

const express = require('express');
const router = express.Router();
const Book = require('../models/Book');
const axios = require('axios');

// Add new book from archive.org
router.post('/admin/add-book', async (req, res) => {
  const { archiveUrl } = req.body;

  try {
    const match = archiveUrl.match(/\/details\/([^\/?#]+)/);
    if (!match) return res.send("❌ Invalid archive.org URL");

    const archiveId = match[1];

    // Fetch title using archive.org metadata API
    const metadataUrl = `https://archive.org/metadata/${archiveId}`;
    const response = await axios.get(metadataUrl);
    const title = response.data.metadata.title || 'Untitled Book';

    // Save book to database
    await Book.create({ title, archiveId });
    res.redirect('/admin');
  } catch (err) {
    console.error("Error adding book:", err.message);
    res.status(500).send("❌ Failed to add book. Please check the archive.org URL.");
  }
});

// Get last bookmark
router.get('/read/book/:id/bookmark', async (req, res) => {
  const Bookmark = require('../models/Bookmark');
  const userId = req.session.user?._id;
  const bookId = req.params.id;

  if (!userId) return res.json({ page: 1 });

  const bookmark = await Bookmark.findOne({ userId, bookId });
  res.json({ page: bookmark?.page || 1 });
});

// Save bookmark
router.post('/read/book/:id/bookmark', async (req, res) => {
  const Bookmark = require('../models/Bookmark');
  const userId = req.session.user?._id;
  const bookId = req.params.id;
  const page = req.body.page;

  if (!userId) return res.status(403).send('Not logged in');

  await Bookmark.findOneAndUpdate(
    { userId, bookId },
    { page },
    { upsert: true }
  );

  res.send('✅ Bookmark saved');
});

module.exports = router;
