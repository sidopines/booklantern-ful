// routes/bookRoutes.js
const express = require('express');
const router = express.Router();

// Helpers to ensure same behavior as the rest of the app
const { ensureAuthenticated } = require('../middleware/auth');

// Optional: local curated Book model (used elsewhere)
let Book = null;
try { Book = require('../models/Book'); } catch (_) {}

// =============== SEARCH (existing app behavior stays the same) ===============
// If you already have a search route in another file, keep it. This is just the
// reader/proxy section you need for Gutenberg.

function allowGutenberg(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./,'').toLowerCase();
    return ['gutenberg.org','gutenberg.net','gutenberg.pglaf.org'].includes(host);
  } catch (_) { return false; }
}

function canonicalGutenbergUrl(gid) {
  // Safe default HTML page for a work
  return `https://www.gutenberg.org/ebooks/${encodeURIComponent(gid)}`;
}

/**
 * Paged reader shell for Gutenberg items
 * /read/gutenberg/:gid/reader?u=<optional Gutenberg URL to start from>
 */
router.get('/read/gutenberg/:gid/reader', async (req, res) => {
  const gid = String(req.params.gid || '').trim();
  const startUrl = typeof req.query.u === 'string' && req.query.u ? req.query.u : canonicalGutenbergUrl(gid);
  return res.render('unified-reader', {
    gid,
    startUrl,
    pageTitle: `Read • #${gid}`,
    pageDescription: 'Distraction-free reading',
  });
});

/**
 * Same-origin proxy that fetches Gutenberg HTML so our iframe and fetch()
 * can read it without cross-origin restrictions.
 *
 * GET /read/gutenberg/:gid/proxy?u=<full gutenberg url>
 */
router.get('/read/gutenberg/:gid/proxy', async (req, res) => {
  try {
    const gid = String(req.params.gid || '').trim();
    const q = String(req.query.u || '').trim();
    const target = allowGutenberg(q) ? q : canonicalGutenbergUrl(gid);

    const rsp = await fetch(target, { redirect: 'follow' });
    const html = await rsp.text();

    // Light rewrite: make relative links absolute so images render in iframe
    const base = new URL(target);
    const rewritten = html.replace(/(src|href)=["'](\/[^"']*)["']/gi, (m, attr, url) => {
      try { return `${attr}="${new URL(url, base).toString()}"`; } catch { return m; }
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Allow iframe on our own origin
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(rewritten);
  } catch (err) {
    console.error('Gutenberg proxy error:', err);
    return res.status(502).send('<!doctype html><meta charset="utf-8"><title>Proxy Error</title><pre>Could not fetch the book page.</pre>');
  }
});

module.exports = router;
