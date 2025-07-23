// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
const Book     = require('../models/Book');

// Helpers
function archiveCover(id) {
  return `https://archive.org/services/img/${id}`;
}
function archiveStreamUrl(id, page = 1) {
  return `https://archive.org/stream/${id}?ui=embed#page=${page}`;
}

/* ========== READ LIST / SEARCH ========== */
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  if (!query) {
    // Show locally stored books (if you still use them)
    const books = await Book.find({}).sort({ createdAt: -1 }).limit(24);
    return res.render('read', { books, query });
  }

  try {
    const q = encodeURIComponent(`(${query}) AND mediatype:texts`);
    const fields = ['identifier', 'title', 'creator'].join(',');
    const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=${fields}&rows=50&page=1&output=json`;

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

/* ========== BOOK VIEWER (Archive) ========== */
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

/* ========== BOOKMARK SAVE (Archive) ========== */
router.post('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { page } = req.body;
  const archiveId = req.params.identifier;

  try {
    const existing = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId
    });

    if (existing) {
      existing.currentPage = page;
      await existing.save();
    } else {
      await Bookmark.create({
        user: req.session.user._id,
        archiveId,
        currentPage: page
      });
    }
    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

/* ========== BOOKMARK GET (Archive) ========== */
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

/* ========== FAVORITE TOGGLE (Archive) ========== */
router.post('/read/book/:identifier/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const archiveId = req.params.identifier;
  try {
    const existing = await Favorite.findOne({
      user: req.session.user._id,
      archiveId
    });

    if (existing) {
      await existing.deleteOne();
      return res.send('❌ Removed from favorites');
    }
    await Favorite.create({
      user: req.session.user._id,
      archiveId
    });
    res.send('❤️ Added to favorites');
  } catch (err) {
    console.error('Favorite toggle error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

module.exports = router;
