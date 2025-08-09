// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
// const Book = require('../models/Book'); // optional if you show local books on /read with no query

/* ------------------------------ Helpers ------------------------------ */
const UA =
  'BookLanternBot/1.0 (+https://booklantern.org; contact admin@booklantern.org)';

function archiveCover(id) {
  return `https://archive.org/services/img/${encodeURIComponent(id)}`;
}
function archiveStreamUrl(id, page = 1) {
  return `https://archive.org/stream/${encodeURIComponent(
    id
  )}?ui=embed#page=${page}`;
}

function safeJoin(val) {
  if (Array.isArray(val)) return val.filter(Boolean).join(', ');
  return val || '';
}

/* --------------------------- Source Fetchers -------------------------- */
/** Archive.org (primary, supports in-site reader) */
async function fetchArchive(query) {
  try {
    const q = encodeURIComponent(`(${query}) AND mediatype:texts`);
    const fl = ['identifier', 'title', 'creator', 'publicdate'].map(
      (f) => `fl[]=${f}`
    );
    const url = `https://archive.org/advancedsearch.php?q=${q}&${fl.join(
      '&'
    )}&rows=40&page=1&output=json`;
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': UA },
    });

    const docs = data?.response?.docs || [];
    return docs.map((d) => {
      const identifier = d.identifier;
      const title = d.title || identifier;
      const creator = safeJoin(d.creator);
      return {
        source: 'archive',
        identifier,
        title,
        creator,
        cover: archiveCover(identifier),
        href: `/read/book/${encodeURIComponent(identifier)}`, // internal viewer
        internal: true,
      };
    });
  } catch (e) {
    console.error('Archive fetch failed:', e.message);
    return [];
  }
}

/** Project Gutenberg (Gutendex) */
async function fetchGutenberg(query) {
  try {
    const url = `https://gutendex.com/books?search=${encodeURIComponent(
      query
    )}`;
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': UA },
    });
    const results = data?.results || [];
    return results.map((b) => {
      const bestCover =
        b.formats?.['image/jpeg'] ||
        b.formats?.['image/png'] ||
        `https://via.placeholder.com/200x280?text=No+Cover`;
      // choose a readable url (HTML > text)
      const readUrl =
        b.formats?.['text/html; charset=utf-8'] ||
        b.formats?.['text/html'] ||
        b.formats?.['text/plain; charset=utf-8'] ||
        b.formats?.['text/plain'] ||
        `https://www.gutenberg.org/ebooks/${b.id}`;

      return {
        source: 'gutenberg',
        identifier: `gutenberg:${b.id}`,
        title: b.title || `Gutenberg #${b.id}`,
        creator: (b.authors || [])
          .map((a) => a.name)
          .filter(Boolean)
          .join(', '),
        cover: bestCover,
        href: readUrl, // external
        internal: false,
      };
    });
  } catch (e) {
    console.error('Gutenberg fetch failed:', e.message);
    return [];
  }
}

/** OpenLibrary (works as catalog; link out to OpenLibrary page/reader/borrow) */
async function fetchOpenLibrary(query) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
      query
    )}&limit=30`;
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': UA },
    });
    const docs = data?.docs || [];
    return docs.map((d) => {
      const title = d.title || 'Untitled';
      const author = safeJoin(d.author_name);
      // Prefer first cover_i if present
      const cover = d.cover_i
        ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
        : `https://via.placeholder.com/200x280?text=No+Cover`;
      // Prefer key to point to work
      const key = d.key || (d.work_key && d.work_key[0]) || null;
      const href = key ? `https://openlibrary.org${key}` : 'https://openlibrary.org';

      return {
        source: 'openlibrary',
        identifier: key ? `openlibrary:${key}` : `openlibrary:unknown`,
        title,
        creator: author,
        cover,
        href, // external
        internal: false,
      };
    });
  } catch (e) {
    console.error('OpenLibrary fetch failed:', e.message);
    return [];
  }
}

/* ------------------------------- Routes -------------------------------- */

/** READ LIST / SEARCH (multi-source) */
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // If no query, show nothing (or you can load local books if you want)
  if (!query) {
    return res.render('read', { books: [], query: '' });
  }

  try {
    const results = await Promise.allSettled([
      fetchArchive(query),
      fetchGutenberg(query),
      fetchOpenLibrary(query),
    ]);

    const arch = results[0].status === 'fulfilled' ? results[0].value : [];
    const gut = results[1].status === 'fulfilled' ? results[1].value : [];
    const ol = results[2].status === 'fulfilled' ? results[2].value : [];

    // Merge and lightly de-dupe by title+creator
    const merged = [...arch, ...gut, ...ol];
    const seen = new Set();
    const books = merged.filter((b) => {
      const key = `${(b.title || '').toLowerCase()}|${(b.creator || '')
        .toLowerCase()
        .trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.render('read', { books, query });
  } catch (err) {
    console.error('Search route error:', err);
    return res.status(500).send('Error performing search');
  }
});

/** INTERNAL VIEWER – Archive.org only (identifier = IA identifier) */
router.get('/read/book/:identifier', async (req, res) => {
  const identifier = req.params.identifier;

  // Is this an Archive item? If not, redirect out gracefully.
  if (/^(gutenberg:|openlibrary:)/i.test(identifier)) {
    // We don’t support in-site reading for these yet; send user to search page.
    return res.redirect(
      `/read?query=${encodeURIComponent(identifier.replace(/^\w+:/, ''))}`
    );
  }

  // Check favorite state if logged in
  let isFavorite = false;
  if (req.session.user) {
    try {
      isFavorite = await Favorite.exists({
        user: req.session.user._id,
        archiveId: identifier, // our Favorites should store archiveId for IA items
      });
    } catch {
      isFavorite = false;
    }
  }

  const book = {
    title: identifier,
    archiveId: identifier,
  };

  res.render('book-viewer', {
    book,
    isFavorite,
    user: req.session.user || null,
  });
});

/** BOOKMARK SAVE (Archive only) */
router.post('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const { page } = req.body;

  try {
    const existing = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier,
    });

    if (existing) {
      existing.currentPage = page;
      await existing.save();
    } else {
      await Bookmark.create({
        user: req.session.user._id,
        archiveId: req.params.identifier,
        currentPage: page,
      });
    }

    res.send('✅ Bookmark saved!');
  } catch (err) {
    console.error('Bookmark error:', err);
    res.status(500).send('Server error');
  }
});

/** BOOKMARK GET (Archive only) */
router.get('/read/book/:identifier/bookmark', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const bookmark = await Bookmark.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier,
    });
    res.json({ page: bookmark?.currentPage || 1 });
  } catch (err) {
    console.error('Bookmark fetch error:', err);
    res.status(500).send('Error loading bookmark');
  }
});

/** FAVORITES TOGGLE (Archive only) */
router.post('/read/book/:identifier/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  const archiveId = req.params.identifier;

  try {
    const existing = await Favorite.findOne({
      user: req.session.user._id,
      archiveId,
    });

    if (existing) {
      await existing.deleteOne();
      res.send('❌ Removed from favorites');
    } else {
      await Favorite.create({
        user: req.session.user._id,
        archiveId,
      });
      res.send('❤️ Added to favorites');
    }
  } catch (err) {
    console.error('Favorite toggle error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

module.exports = router;
