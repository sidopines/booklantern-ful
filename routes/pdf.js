// routes/pdf.js
const express = require('express');
const router = express.Router();

/** Require login for reading */
function requireUser(req, res, next) {
  if (!req.session || !req.session.user) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/read');
    return res.redirect(`/login?next=${nextUrl}`);
  }
  next();
}

/**
 * Inline PDF viewer
 * Usage: /read/pdf?src=<absolute-pdf-url>&title=<optional>
 *   or:  /pdf-viewer?src=<absolute-pdf-url>&title=<optional>
 * We render views/pdf-viewer.ejs which embeds the PDF (iframes),
 * and shows an "Open externally" button if embedding is blocked.
 */
function handlePdfViewer(req, res) {
  const src = typeof req.query.src === 'string' ? req.query.src : '';
  const title = typeof req.query.title === 'string' ? req.query.title : 'PDF';
  return res.render('pdf-viewer', {
    pageTitle: `Read • ${title}`,
    pageDescription: `Read ${title} (PDF)`,
    pdfUrl: src,
    query: req.query
  });
}

router.get('/read/pdf', requireUser, handlePdfViewer);
router.get('/pdf-viewer', requireUser, handlePdfViewer);

module.exports = router;
