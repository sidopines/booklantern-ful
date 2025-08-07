// routes/bookRoutes.js
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');

// Helpers (as before)…
function archiveCover(id) { /* … */ }
async function searchArchive(q){ /* … */ }
async function searchGutenberg(q){ /* … */ }
async function searchOpenLibrary(q){ /* … */ }

//===== SEARCH LIST / READ PAGE =====
router.get('/read', async (req, res) => {
  const query = (req.query.query||'').trim();
  let books = [];

  if (query) {
    const [arch, gut, ol] = await Promise.all([
      searchArchive(query),
      searchGutenberg(query),
      searchOpenLibrary(query),
    ]);
    // dedupe by title+creator
    const seen = new Set();
    books = [...arch, ...gut, ...ol].filter(b => {
      const key = `${b.title}||${b.creator}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return res.render('read', { books, query });
});

//===== BOOK VIEWER =====
router.get('/read/book/:source/:identifier', async (req, res) => {
  const { source, identifier } = req.params;

  // figure out a human title/creator/cover if you saved any in Mongo, otherwise fallback:
  const book = { source, identifier, title: identifier, creator: '', cover: null };

  // check favorite state
  let isFavorite = false;
  if (req.session.user) {
    isFavorite = await Favorite.exists({
      user:      req.session.user._id,
      source,
      identifier
    });
  }

  return res.render('book-viewer', {
    book,
    isFavorite,
    user: req.session.user || null
  });
});

//===== BOOKMARKS (adjusted to track source+identifier) =====
router.post('/read/book/:source/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { source, identifier } = req.params;
  const { page } = req.body;

  try {
    const existing = await Bookmark.findOne({
      user:       req.session.user._id,
      source,
      identifier
    });
    if (existing) {
      existing.currentPage = page;
      await existing.save();
    } else {
      await Bookmark.create({
        user:        req.session.user._id,
        source,
        identifier,
        currentPage: page
      });
    }
    return res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

router.get('/read/book/:source/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const bm = await Bookmark.findOne({
      user:       req.session.user._id,
      source:     req.params.source,
      identifier: req.params.identifier
    });
    return res.json({ page: bm?.currentPage || 1 });
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error loading bookmark');
  }
});

module.exports = router;
