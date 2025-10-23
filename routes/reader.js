// routes/reader.js
const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE,
  { auth: { persistSession: false } }
);

// GET /reader/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: book, error } = await supabase
      .from('curated_books')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !book) throw (error || new Error('Book not found.'));

    // Try to guess an EPUB URL if we only have provider/id
    let epubUrl = null;
    if (book.source_url && /\.epub(\.noimages|\.images)?$/i.test(book.source_url)) {
      epubUrl = book.source_url;
    } else if (book.provider === 'gutenberg' && book.provider_id) {
      // Common Gutenberg pattern. Change to ".epub.noimages" if you prefer that default.
      epubUrl = `https://www.gutenberg.org/ebooks/${encodeURIComponent(book.provider_id)}.epub.images`;
    }

    res.render('reader', { title: book.title, book, epubUrl });
  } catch (e) {
    console.error('[reader] load failed:', e);
    res.status(404).send('Book not found');
  }
});

module.exports = router;
