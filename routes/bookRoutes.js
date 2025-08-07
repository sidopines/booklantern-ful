// routes/bookRoutes.js

const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Archive.org cover URL
function archiveCover(id) {
  return `https://archive.org/services/img/${id}`;
}

// 1) Archive.org text search
async function searchArchive(query) {
  const q = encodeURIComponent(`(${query}) AND mediatype:texts`);
  const fields = ['identifier','title','creator','publicdate'].join(',');
  const url = `https://archive.org/advancedsearch.php`
    + `?q=${q}&fl[]=${fields}&rows=30&page=1&output=json`;

  const { data } = await axios.get(url, { timeout: 10000 });
  const docs = data.response?.docs || [];
  return docs.map(d => ({
    source:     'archive',
    identifier: d.identifier,
    title:      d.title || d.identifier,
    creator:    Array.isArray(d.creator) ? d.creator.join(', ') : d.creator || 'Unknown',
    cover:      archiveCover(d.identifier)
  }));
}

// 2) Project Gutenberg via Gutendex API
async function searchGutenberg(query) {
  const url = `https://gutendex.com/books`
    + `?search=${encodeURIComponent(query)}&languages=en&mime_type=text%2Fplain`;

  const { data } = await axios.get(url, { timeout: 10000 });
  const results = data.results || [];
  return results.map(b => ({
    source:     'gutenberg',
    identifier: b.id.toString(),
    title:      b.title,
    creator:    Array.isArray(b.authors) ? b.authors.map(a => a.name).join(', ') : '',
    cover:      b.formats['image/jpeg'] || b.formats['image/png'] || null
  }));
}

// 3) OpenLibrary search
async function searchOpenLibrary(query) {
  const url = `https://openlibrary.org/search.json`
    + `?q=${encodeURIComponent(query)}&limit=30`;

  const { data } = await axios.get(url, { timeout: 10000 });
  const docs = data.docs || [];
  return docs.map(d => ({
    source:     'openlibrary',
    identifier: (d.key || '').replace('/works/', ''), // e.g. "OL12345W"
    title:      d.title,
    creator:    Array.isArray(d.author_name) ? d.author_name.join(', ') : d.author_name || '',
    cover:      d.cover_i
                 ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
                 : null
  }));
}

// ─── READ / SEARCH BOOKS ────────────────────────────────────────────────────────
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();
  let books = [];

  try {
    if (!query) {
      // no query → show last 24 saved in Mongo, or empty
      books = await []; 
    } else {
      // parallel multi-source search
      const [arch, gut, ol] = await Promise.all([
        searchArchive(query),
        searchGutenberg(query),
        searchOpenLibrary(query),
      ]);

      // merge + dedupe by title+creator
      const seen = new Set();
      books = [...arch, ...gut, ...ol].filter(b => {
        const key = `${b.title}||${b.creator}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    res.render('read', { books, query });
  } catch (err) {
    console.error('Multi-source search error:', err);
    res.status(500).send('Error searching books');
  }
});

// ─── BOOK VIEWER (same as before) ────────────────────────────────────────────────
router.get('/read/book/:identifier', async (req, res) => {
  const identifier = req.params.identifier;
  // check login/fav state
  let isFavorite = false;
  if (req.session.user) {
    isFavorite = await Favorite.exists({
      user:      req.session.user._id,
      archiveId: identifier
    });
  }
  const book = { title: identifier, archiveId: identifier };
  res.render('book-viewer', { book, isFavorite, user: req.session.user || null });
});

// ─── BOOKMARK SAVE & FETCH (unchanged) ─────────────────────────────────────────
router.post('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { page } = req.body;
  try {
    const existing = await Bookmark.findOne({
      user:      req.session.user._id,
      archiveId: req.params.identifier
    });
    if (existing) {
      existing.currentPage = page;
      await existing.save();
    } else {
      await Bookmark.create({
        user:        req.session.user._id,
        archiveId:   req.params.identifier,
        currentPage: page
      });
    }
    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

router.get('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const bookmark = await Bookmark.findOne({
      user:      req.session.user._id,
      archiveId: req.params.identifier
    });
    res.json({ page: bookmark?.currentPage || 1 });
  } catch (err) {
    console.error('Bookmark fetch error:', err);
    res.status(500).send('Error loading bookmark');
  }
});

module.exports = router;
