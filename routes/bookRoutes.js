// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
const Book = require('../models/Book'); // optional local books (admin-added)

// ---------- Helpers ----------
const aimg = (id) => `https://archive.org/services/img/${encodeURIComponent(id)}`;
const streamUrl = (id, page = 1) =>
  `https://archive.org/stream/${encodeURIComponent(id)}?ui=embed#page=${page}`;

// Safe axios.get (always resolves)
async function safeGet(url, config = {}) {
  try {
    const { data } = await axios.get(url, { timeout: 12000, ...config });
    return { ok: true, data };
  } catch (err) {
    console.error('[fetch error]', url, err.message);
    return { ok: false, data: null };
  }
}

// Map a minimal “book” object that our read.ejs expects and our viewer can open
function asIAItem(identifier, title, creator) {
  return {
    identifier,
    title: title || identifier,
    creator: Array.isArray(creator) ? creator.join(', ') : (creator || ''),
    cover: aimg(identifier),
    // viewer uses /read/book/:identifier → archive.org embed
  };
}

// ---------- Source fetchers (return arrays, never throw) ----------

// 1) Archive.org (primary)
async function fetchArchive(query) {
  if (!query) return [];
  const q = encodeURIComponent(`(${query}) AND mediatype:texts`);
  // fields must be added per fl[]= parameter; pass multiple fl[] items
  const url =
    `https://archive.org/advancedsearch.php?q=${q}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator` +
    `&rows=50&page=1&output=json`;

  const res = await safeGet(url);
  if (!res.ok) return [];
  const docs = res.data?.response?.docs || [];
  return docs
    .filter(d => d.identifier)
    .map(d => asIAItem(d.identifier, d.title, d.creator));
}

// 2) OpenLibrary (ONLY items that have an Internet Archive scan via `ia` field)
async function fetchOpenLibraryIA(query) {
  if (!query) return [];
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=50`;
  const res = await safeGet(url);
  if (!res.ok) return [];
  const docs = Array.isArray(res.data?.docs) ? res.data.docs : [];

  // Keep only docs that have IA identifiers we can embed
  const withIA = docs.filter(d => Array.isArray(d.ia) && d.ia.length > 0);
  return withIA.map(d => {
    const identifier = d.ia[0]; // first IA scan id
    const title = d.title || identifier;
    const creator = Array.isArray(d.author_name) ? d.author_name.join(', ') : d.author_name;
    return asIAItem(identifier, title, creator);
  });
}

// (Optional) 3) Gutenberg via Gutendex — Disabled for now because our viewer
// only supports IA embeds. If/when you add external readers, you can enable.
// Leaving as a stub that safely returns [] to avoid crashes.
async function fetchGutenberg(_query) {
  return [];
}

// ---------- READ LIST / SEARCH ----------
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // If no query given, optionally show latest admin-added local books
  if (!query) {
    const books = await Book.find({}).sort({ createdAt: -1 }).limit(24);
    // Map local Book model to the same shape (viewer needs identifier; local ones won’t open IA)
    // So for local, link will be /read/book/<_id>, which your viewer doesn’t handle.
    // We’ll still show them, but they’re secondary to search results.
    const mapped = books.map(b => ({
      identifier: b._id.toString(),
      title: b.title,
      creator: b.author || '',
      cover: b.coverImage || 'https://via.placeholder.com/200x280?text=No+Cover'
    }));
    return res.render('read', { books: mapped, query });
  }

  try {
    const [arch, ol, gut] = await Promise.all([
      fetchArchive(query),
      fetchOpenLibraryIA(query),
      fetchGutenberg(query)
    ]);

    // All are arrays by design. Merge and de-dup by identifier
    const all = [...arch, ...ol, ...gut];
    const seen = new Set();
    const books = all.filter(b => {
      if (!b || !b.identifier) return false;
      if (seen.has(b.identifier)) return false;
      seen.add(b.identifier);
      return true;
    });

    return res.render('read', { books, query });
  } catch (err) {
    console.error('Search route fatal error:', err);
    // Render gracefully instead of crashing
    return res.render('read', { books: [], query });
  }
});

// ---------- VIEWER (Archive.org embed by Internet Archive identifier) ----------
router.get('/read/book/:identifier', async (req, res) => {
  const identifier = req.params.identifier;

  // If identifier looks like a Mongo ObjectId (local Book), try to display minimal info
  const looksLikeObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
  let bookTitle = identifier;
  if (looksLikeObjectId) {
    const local = await Book.findById(identifier).lean().catch(() => null);
    if (local) bookTitle = local.title || identifier;
  }

  // favorite state for IA items
  let isFavorite = false;
  if (req.session.user) {
    isFavorite = await Favorite.exists({
      user: req.session.user._id,
      archiveId: identifier
    });
  }

  const book = {
    title: bookTitle,
    archiveId: identifier // the viewer template uses archiveId for the embed
  };

  return res.render('book-viewer', {
    book,
    isFavorite,
    user: req.session.user || null
  });
});

// ---------- BOOKMARK SAVE (by IA identifier) ----------
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
      existing.currentPage = page || 1;
      await existing.save();
    } else {
      await Bookmark.create({
        user: req.session.user._id,
        archiveId,
        currentPage: page || 1
      });
    }
    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

// ---------- BOOKMARK GET ----------
router.get('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');

  const archiveId = req.params.identifier;
  try {
    const bookmark = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId
    });
    res.json({ page: bookmark?.currentPage || 1 });
  } catch (err) {
    console.error('Bookmark fetch error:', err);
    res.status(500).json({ page: 1 });
  }
});

// ---------- FAVORITE TOGGLE (by IA identifier) ----------
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
    } else {
      await Favorite.create({
        user: req.session.user._id,
        archiveId
      });
      return res.send('❤️ Added to favorites');
    }
  } catch (err) {
    console.error('Favorite toggle error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

module.exports = router;
