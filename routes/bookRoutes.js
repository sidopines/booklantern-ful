// routes/bookRoutes.js
// Handles search, reading, bookmarking & favorites for Archive.org + local books

const express   = require('express');
const axios     = require('axios');
const mongoose  = require('mongoose');
const router    = express.Router();

const Bookmark  = require('../models/Bookmark');
const Favorite  = require('../models/Favorite');
const Book      = require('../models/Book');

// ---------- Helpers ----------
const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

const archiveCover = (id) =>
  `https://archive.org/services/img/${id}`;

const archiveStreamUrl = (id, page = 1) =>
  `https://archive.org/stream/${id}?ui=embed#page=${page}`;

// Build a "book" object that the views expect
function buildBookObject(docOrId) {
  if (typeof docOrId === 'string') {
    return {
      _id: null,
      title: docOrId,
      archiveId: docOrId,
      identifier: docOrId,
      cover: archiveCover(docOrId)
    };
  }
  // Mongoose doc
  const doc = docOrId.toObject ? docOrId.toObject() : docOrId;
  const archiveId = doc.archiveId || doc.identifier;
  return {
    ...doc,
    archiveId,
    identifier: archiveId,
    cover: doc.cover || (archiveId ? archiveCover(archiveId) : '')
  };
}

// ---------- Search / List ----------
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // If no query -> show last saved local books (optional)
  if (!query) {
    const books = await Book.find({}).sort({ createdAt: -1 }).limit(24);
    const mapped = books.map(buildBookObject);
    return res.render('read', { books: mapped, query });
  }

  try {
    // Archive.org search
    const q       = encodeURIComponent(`(${query}) AND mediatype:texts`);
    const fields  = ['identifier', 'title', 'creator', 'publicdate'].join(',');
    const url     = `https://archive.org/advancedsearch.php?q=${q}&fl[]=${fields}&rows=50&page=1&output=json`;

    const { data } = await axios.get(url, { timeout: 12000 });
    const docs     = data?.response?.docs || [];

    const books = docs.map(d => ({
      identifier: d.identifier,
      title: d.title || d.identifier,
      creator: Array.isArray(d.creator) ? d.creator.join(', ') : d.creator,
      cover: archiveCover(d.identifier)
    }));

    res.render('read', { books, query });
  } catch (err) {
    console.error('Archive search error:', err.message);
    res.status(500).send('Error searching Archive.org');
  }
});

// ---------- Viewer ----------
router.get('/read/book/:slug', async (req, res) => {
  const slug = req.params.slug;
  let bookDoc = null;
  let bookObj;

  try {
    if (isObjectId(slug)) {
      bookDoc = await Book.findById(slug);
      if (!bookDoc) {
        // If accidentally passed an ObjectId that doesn't exist, fallback to treating as identifier
        bookObj = buildBookObject(slug);
      } else {
        bookObj = buildBookObject(bookDoc);
      }
    } else {
      // Pure archive identifier
      bookObj = buildBookObject(slug);
    }

    // If still no archive id → 404
    if (!bookObj.archiveId) return res.status(404).send('Book not found');

    // Favorite?
    let isFavorite = false;
    if (req.session.user) {
      const favQuery = {
        user: req.session.user._id,
        $or: []
      };
      if (bookDoc?._id) favQuery.$or.push({ book: bookDoc._id });
      favQuery.$or.push({ archiveId: bookObj.archiveId });

      isFavorite = await Favorite.exists(favQuery);
    }

    res.render('book-viewer', {
      book: bookObj,
      isFavorite,
      user: req.session.user || null
    });
  } catch (err) {
    console.error('Viewer error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ---------- Bookmark SAVE ----------
router.post('/read/book/:slug/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { page } = req.body;
  const slug = req.params.slug;

  try {
    const key = isObjectId(slug) ? { book: slug } : { archiveId: slug };

    let bm = await Bookmark.findOne({ user: req.session.user._id, ...key });
    if (!bm) {
      bm = await Bookmark.create({
        user: req.session.user._id,
        currentPage: page,
        ...key
      });
    } else {
      bm.currentPage = page;
      await bm.save();
    }
    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

// ---------- Bookmark GET ----------
router.get('/read/book/:slug/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const slug = req.params.slug;

  try {
    const key = isObjectId(slug) ? { book: slug } : { archiveId: slug };
    const bm  = await Bookmark.findOne({ user: req.session.user._id, ...key });
    res.json({ page: bm?.currentPage || 1 });
  } catch (err) {
    console.error('Bookmark fetch error:', err);
    res.status(500).send('Error loading bookmark');
  }
});

// ---------- Favorite TOGGLE ----------
router.post('/read/book/:slug/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const slug = req.params.slug;

  try {
    let bookDoc = null;
    if (isObjectId(slug)) {
      bookDoc = await Book.findById(slug);
    }

    const favQuery = {
      user: req.session.user._id
    };

    if (bookDoc?._id) {
      favQuery.book = bookDoc._id;
    } else {
      favQuery.archiveId = slug;
    }

    const existing = await Favorite.findOne(favQuery);

    if (existing) {
      await existing.deleteOne();
      return res.send('❌ Removed from favorites');
    }

    await Favorite.create({
      user: req.session.user._id,
      ...(bookDoc?._id ? { book: bookDoc._id } : { archiveId: slug })
    });

    res.send('❤️ Added to favorites');
  } catch (err) {
    console.error('Favorite toggle error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

module.exports = router;
