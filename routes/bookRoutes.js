// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
const Book = require('../models/Book'); // optional, for local/admin-curated items

// ---------- helpers ----------
const http = axios.create({
  timeout: 10000, // 10s max
});

// Build standard card object
function card({
  identifier = '',
  title = '',
  creator = '',
  cover = '',
  readerUrl = '',
  source = '',
  description = '',
}) {
  return { identifier, title, creator, cover, readerUrl, source, description };
}

function archiveCover(id) {
  return `https://archive.org/services/img/${id}`;
}
function archiveReader(id, page = 1) {
  return `https://archive.org/stream/${id}?ui=embed#page=${page}`;
}

// ---------- external fetchers (ALWAYS return an array) ----------
async function searchArchive(q) {
  try {
    const query = encodeURIComponent(`(${q}) AND mediatype:texts`);
    const fields = ['identifier', 'title', 'creator', 'description', 'publicdate'].join(',');
    const url = `https://archive.org/advancedsearch.php?q=${query}&fl[]=${fields}&rows=30&page=1&output=json`;
    const { data } = await http.get(url);
    const docs = data?.response?.docs || [];
    return docs.map(d =>
      card({
        identifier: d.identifier,
        title: d.title || d.identifier || 'Untitled',
        creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
        cover: archiveCover(d.identifier),
        readerUrl: archiveReader(d.identifier, 1),
        source: 'archive',
        description: (Array.isArray(d.description) ? d.description[0] : d.description) || '',
      })
    );
  } catch (e) {
    console.error('Archive search error:', e.message);
    return [];
  }
}

async function searchGutenberg(q) {
  try {
    const url = `https://gutendex.com/books?search=${encodeURIComponent(q)}`;
    const { data } = await http.get(url);
    const results = data?.results || [];
    return results.map(b => {
      const authors = (b.authors || []).map(a => a.name).join(', ');
      const cover =
        b.formats?.['image/jpeg'] ||
        b.formats?.['image/jpg'] ||
        '';
      // Prefer HTML reader if available, else text/plain, else fallback to book page
      const readerUrl =
        b.formats?.['text/html; charset=utf-8'] ||
        b.formats?.['text/html'] ||
        b.formats?.['text/plain; charset=utf-8'] ||
        `https://www.gutenberg.org/ebooks/${b.id}`;
      return card({
        identifier: `gutenberg:${b.id}`,
        title: b.title || `Gutenberg #${b.id}`,
        creator: authors,
        cover,
        readerUrl,
        source: 'gutenberg',
      });
    });
  } catch (e) {
    console.error('Gutenberg search error:', e.message);
    return [];
  }
}

async function searchOpenLibrary(q) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=30`;
    const { data } = await http.get(url);
    const docs = data?.docs || [];
    return docs.map(d => {
      const title = d.title || 'Untitled';
      const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : (d.author_name || '');
      const cover = d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '';
      // best effort: link to work or book page
      const key = d.key || (Array.isArray(d.edition_key) ? `/books/${d.edition_key[0]}` : null);
      const readerUrl = key ? `https://openlibrary.org${key}` : 'https://openlibrary.org';
      const identifier = `openlibrary:${(d.key || d.edition_key?.[0] || title).replace(/\//g, '_')}`;
      return card({
        identifier,
        title,
        creator: author,
        cover,
        readerUrl,
        source: 'openlibrary',
      });
    });
  } catch (e) {
    console.error('OpenLibrary search error:', e.message);
    return [];
  }
}

// ---------- READ LIST / SEARCH ----------
router.get('/read', async (req, res) => {
  const query = (req.query.query || '').trim();

  // If empty query: show locally saved/admin books (if any)
  if (!query) {
    try {
      const books = await Book.find({}).sort({ createdAt: -1 }).limit(24);
      // normalize for template
      const normalized = books.map(b =>
        card({
          identifier: String(b._id),
          title: b.title,
          creator: b.author || '',
          cover: b.coverImage || '',
          readerUrl: b.sourceUrl || '',
          source: 'local',
          description: b.description || '',
        })
      );
      return res.render('read', { books: normalized, query });
    } catch (e) {
      console.error('Read (no query) error:', e);
      return res.render('read', { books: [], query });
    }
  }

  try {
    const [arch = [], gut = [], ol = []] = await Promise.all([
      searchArchive(query),
      searchGutenberg(query),
      searchOpenLibrary(query),
    ]);

    // merge safely (each is guaranteed array)
    let books = []
      .concat(arch, gut, ol)
      .filter(b => b && (b.title || b.identifier));

    // optional: simple de-dupe by (title + creator)
    const seen = new Set();
    books = books.filter(b => {
      const key = `${(b.title || '').toLowerCase()}|${(b.creator || '').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // limit
    books = books.slice(0, 60);

    return res.render('read', { books, query });
  } catch (err) {
    console.error('Read search fatal error:', err);
    // Never crash the page—render empty with a friendly state
    return res.render('read', { books: [], query });
  }
});

// ---------- VIEWER (ARCHIVE-ONLY INTERNAL READER) ----------
/**
 * We only support internal reader for Archive.org items.
 * For Gutenberg/OpenLibrary items the /read page links out using readerUrl,
 * so they don't hit this route.
 */
router.get('/read/book/:identifier', async (req, res) => {
  const identifier = req.params.identifier;

  // If it looks like external identifiers, redirect to /read with a message or fail gracefully
  if (identifier.startsWith('gutenberg:') || identifier.startsWith('openlibrary:')) {
    // just redirect back to /read; the card already has external links
    return res.redirect(`/read?query=${encodeURIComponent(identifier.replace(/^.*?:/, ''))}`);
  }

  // Archive item (or local DB entry that stores archiveId)
  let isFavorite = false;
  try {
    if (req.session.user) {
      // Either you store Favorites by archiveId or by Book ref. We’ll check both.
      const byArchive = await Favorite.exists({
        user: req.session.user._id,
        archiveId: identifier,
      });
      const byBook = await Favorite.exists({
        user: req.session.user._id,
        // if you saved a local Book document that has archiveId===identifier
        // you might look it up here; to keep simple we just check archiveId variant
      });
      isFavorite = !!(byArchive || byBook);
    }
  } catch (e) {
    console.error('Favorite lookup error:', e.message);
  }

  const book = { title: identifier, archiveId: identifier };
  return res.render('book-viewer', {
    book,
    isFavorite,
    user: req.session.user || null,
  });
});

// ---------- BOOKMARKS (ARCHIVE-ONLY) ----------
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

// ---------- FAVORITES TOGGLE (ARCHIVE-ONLY HERE) ----------
router.post('/read/book/:identifier/favorite', async (req, res) => {
  if (!req.session.user) return res.status(401).send('Login required');
  try {
    const existing = await Favorite.findOne({
      user: req.session.user._id,
      archiveId: req.params.identifier,
    });

    if (existing) {
      await existing.deleteOne();
      res.send('❌ Removed from favorites');
    } else {
      await Favorite.create({
        user: req.session.user._id,
        archiveId: req.params.identifier,
      });
      res.send('❤️ Added to favorites');
    }
  } catch (err) {
    console.error('Favorite toggle error:', err);
    res.status(500).send('Failed to toggle favorite');
  }
});

module.exports = router;
