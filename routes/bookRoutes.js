// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
const Book     = require('../models/Book'); // optional local storage

// Helpers
const archiveCover = id => `https://archive.org/services/img/${id}`;
const fields = ['identifier','title','creator','publicdate'];

/* ----------------- READ LIST / SEARCH ----------------- */
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // No search? Show locally stored books (optional)
  if (!query) {
    const books = await Book.find({}).sort({ createdAt: -1 }).limit(24);
    return res.render('read', { books, query });
  }

  try {
    const q = encodeURIComponent(`(${query}) AND mediatype:texts`);
    const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=${fields.join(',')}&rows=50&page=1&output=json`;

    const { data } = await axios.get(url, { timeout: 10000 });
    const docs = data?.response?.docs || [];

    const books = docs.map(d => ({
      identifier: d.identifier,
      title: d.title || d.identifier,
      creator: Array.isArray(d.creator) ? d.creator.join(', ') : d.creator,
      cover: archiveCover(d.identifier)
    }));

    res.render('read', { books, query });
  } catch (err) {
    console.error('Archive search error:', err);
    res.status(500).send('Error searching Archive.org');
  }
});

/* ----------------- VIEWER ----------------- */
router.get('/read/book/:identifier', async (req, res) => {
  const identifier = req.params.identifier;

  let isFavorite = false;
  if (req.session.user) {
    isFavorite = await Favorite.exists({
      user: req.session.user._id,
      archiveId: identifier
    });
  }

  const book = {
    title: identifier,
    archiveId: identifier
  };

  res.render('book-viewer', {
    book,
    isFavorite,
    user: req.session.user || null
  });
});

/* ----------------- FAVORITE TOGGLE (ARCHIVE) ----------------- */
router.post('/read/book/:identifier/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');

  const identifier = req.params.identifier;

  try {
    const existing = await Favorite.findOne({
      user: req.session.user._id,
      archiveId: identifier
    });

    if (existing) {
      await existing.deleteOne();
      return res.send('❌ Removed from favorites');
    }

    await Favorite.create({
      user: req.session.user._id,
      archiveId: identifier
    });

    res.send('❤️ Added to favorites');
  } catch (err) {
    console.error('Favorite toggle error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

/* ----------------- BOOKMARK SAVE ----------------- */
router.post('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { page } = req.body;

  try {
    const existing = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier
    });

    if (existing) {
      existing.currentPage = page;
      await existing.save();
    } else {
      await Bookmark.create({
        user: req.session.user._id,
        archiveId: req.params.identifier,
        currentPage: page
      });
    }

    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

/* ----------------- BOOKMARK GET ----------------- */
router.get('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const bookmark = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier
    });
    res.json({ page: bookmark?.currentPage || 1 });
  } catch (err) {
    console.error('Bookmark fetch error:', err);
    res.status(500).send('Error loading bookmark');
  }
});

module.exports = router;
