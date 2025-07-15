// routes/sitemap.js

const express = require('express');
const router = express.Router();
const Book = require('../models/Book');
const Video = require('../models/Video');

router.get('/sitemap.xml', async (req, res) => {
  const hostname = 'https://booklantern.org';
  try {
    const books = await Book.find({});
    const videos = await Video.find({});

    let urls = [
      { loc: '/', priority: 1.0 },
      { loc: '/about', priority: 0.8 },
      { loc: '/contact', priority: 0.8 },
      { loc: '/watch', priority: 0.9 },
      { loc: '/read', priority: 0.9 },
    ];

    books.forEach(book => {
      urls.push({ loc: `/read/book/${book._id}`, priority: 0.7 });
    });

    videos.forEach(video => {
      urls.push({ loc: `/player/${video._id}`, priority: 0.6 });
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `
  <url>
    <loc>${hostname}${url.loc}</loc>
    <priority>${url.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap error:', err);
    res.status(500).send('Error generating sitemap');
  }
});

module.exports = router;
