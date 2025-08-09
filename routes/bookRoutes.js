// routes/bookRoutes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const Bookmark = require('../models/Bookmark');
const Favorite = require('../models/Favorite');
const Book = require('../models/Book'); // optional, for local/admin-curated items

// ---------- axios (shared) ----------
const http = axios.create({
  timeout: 10000, // 10s max
  headers: {
    'User-Agent': 'BookLantern/1.0 (+booklantern.org)',
    'Accept': 'application/json,text/plain,*/*'
  }
});

// ---------- helpers ----------
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

// Improved Open Library mapper: better cover fallback, stable links, stable id
async function searchOpenLibrary(q) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=30`;
    const { data } = await http.get(url);
    const docs = data?.docs || [];
    return docs.map(d => {
      const title = d.title || 'Untitled';
      const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : (d.author_name || '');
      const cover = d.cover_i
        ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
        : 'https://openlibrary.org/images/icons/avatar_book-sm.png';

      // Prefer work link when available, else edition, else generic OL
      const workKey = d.key && String(d.key).startsWith('/works/') ? d.key : null;
      const editionKey = Array.isArray(d.edition_key) ? d.edition_key[0] : null;
      const readerUrl = workKey
        ? `https://openlibrary.org${workKey}`
        : (editionKey ? `https://openlibrary.org/books/${editionKey}` : `https://openlibrary.org`);

      // Stable identifier: work key if present; else edition; else title
      const rawId = workKey || (editionKey ? `/books/${editionKey}` : title);
      const identifier = `openlibrary:${String(rawId).replace(/\//g, '_')}`;

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

    console.log(`READ SEARCH "${query}" — archive:${arch.length} gutenberg:${gut.length} openlibrary:${ol.length}`);

    // Merge safely
    let books = []
      .concat(arch, gut, ol)
      .filter(b => b && (b.title || b.identifier));

    // Simple de-dupe by (title + creator). Prefer entries that have covers and a readerUrl.
    const seen = new Map();
    for (const b of books) {
      const key = `${(b.title || '').toLowerCase()}|${(b.creator || '').toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, b);
      } else {
        const prev = seen.get(key);
        const score = (x) => (x.cover ? 1 : 0) + (x.readerUrl ? 1 : 0);
        if (score(b) > score(prev)) seen.set(key, b);
      }
    }
    books = Array.from(seen.values()).slice(0, 60);

    return res.render('read', { books, query });
  } catch (err) {
    console.error('Read search fatal error:', err);
    return res.render('read', { books: [], query });
  }
});

// ---------- VIEWER (ARCHIVE-ONLY INTERNAL READER) ----------
/**
 * We only support internal reader for Archive.org items.
 * For Gutenberg/OpenLibrary items the /read page links out using readerUrl.
 */
router.get('/read/book/:identifier', async (req, res) => {
  const identifier = req.params.identifier;

  // If it looks like external identifiers, bounce back to search
  if (identifier.startsWith('gutenberg:') || identifier.startsWith('openlibrary:')) {
    return res.redirect(`/read?query=${encodeURIComponent(identifier.replace(/^.*?:/, ''))}`);
  }

  let isFavorite = false;
  try {
    if (req.session.user) {
      const byArchive = await Favorite.exists({
        user: req.session.user._id,
        archiveId: identifier,
      });
      const byBook = await Favorite.exists({
        user: req.session.user._id,
        // if you store a Book doc mapping to this archiveId, you could check it here
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
