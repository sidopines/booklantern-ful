// routes/bookRoutes.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');

// If you have local models for favorites/bookmarks you can require them here
// const Favorite = require('../models/Favorite');

const ALLOWED_GUTENBERG_HOSTS = new Set([
  'www.gutenberg.org',
  'gutenberg.org'
]);

/** Build a safe default Gutenberg HTML URL for a given ID */
function defaultGutenbergHtmlUrl(gid) {
  // Common stable pattern
  return `https://www.gutenberg.org/cache/epub/${gid}/pg${gid}-images.html`;
}

/** Very small "is this a Gutenberg URL?" guard */
function isAllowedGutenbergUrl(u) {
  try {
    const url = new URL(u);
    return ALLOWED_GUTENBERG_HOSTS.has(url.hostname);
  } catch (_) { return false; }
}

/* ============================
 * SEARCH & GENERAL READ LIST
 * ==========================*/

// /read (search or blank page)
router.get('/read', async (req, res) => {
  const q = (req.query.query || '').trim();

  // Your existing search aggregation goes here.
  // For now, just render the page and let client fetch picks if q is empty.
  res.render('read', {
    pageTitle: 'Explore Free Books',
    pageDescription: 'Browse and read books fetched from multiple free sources.',
    query: q,
    books: [] // If you already attach results, pass them here.
  });
});

/* ==========================================
 * ARCHIVE.ORG VIEWER (kept as-is in your app)
 * (Route example: /read/book/:identifier)
 * ========================================*/

/* ===================================================
 * GUTENBERG: Kindle-style reader (paginated) VIEW
 *  - login required (gating)
 *  - renders our unified reader shell
 * =================================================*/
router.get('/read/gutenberg/:gid/reader', ensureAuthenticated, async (req, res) => {
  const gid = String(req.params.gid).trim();
  const readerUrl = req.query.u && isAllowedGutenbergUrl(req.query.u)
    ? req.query.u
    : defaultGutenbergHtmlUrl(gid);

  // lightweight "book" object for the header
  const book = {
    identifier: `gutenberg:${gid}`,
    title: 'Project Gutenberg Book',
    author: '',
    creator: ''
  };

  return res.render('unified-reader', {
    pageTitle: 'Reader',
    pageDescription: 'Read in a clean, paginated reader.',
    gutenbergId: gid,
    readerUrl,
    book
  });
});

/* ===================================================
 * GUTENBERG HTML API (used by the reader.js)
 *  - fetches Gutenberg HTML, strips scripts/styles
 *  - returns { html, title?, author? }
 * =================================================*/
router.get('/api/gutenberg/:gid/html', ensureAuthenticated, async (req, res) => {
  try {
    const gid = String(req.params.gid).trim();
    const rawUrl = req.query.u || defaultGutenbergHtmlUrl(gid);
    if (!isAllowedGutenbergUrl(rawUrl)) {
      return res.status(400).json({ error: 'Bad URL host' });
    }

    const r = await fetch(rawUrl, { redirect: 'follow' });
    if (!r.ok) {
      return res.status(502).json({ error: 'Failed to fetch Gutenberg source' });
    }
    const html = await r.text();

    const bodyHtml = extractBody(html);
    const cleaned = basicStrip(bodyHtml);

    const meta = {
      title: (html.match(/<title>([\s\S]*?)<\/title>/i) || [,''])[1].trim()
    };

    return res.json({ html: cleaned, ...meta });
  } catch (e) {
    console.error('gutenberg html api error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
});

function extractBody(html) {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}
function basicStrip(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

module.exports = router;
