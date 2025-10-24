// routes/reader.js — In-site EPUB/PDF reader shell
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

function getSupabaseAnon() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.supabaseUrl ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.PUBLIC_SUPABASE_URL;

  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.supabaseKey ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/* GET /reader/:id
   Renders an internal reader page that loads EPUB.js / PDF.js in your own site.
   Expects curated_books.file_url (direct epub/pdf) or falls back to source_url.
-------------------------------------------------------------------------- */
router.get('/:id', async (req, res) => {
  const sb = getSupabaseAnon();
  const id = String(req.params.id || '');

  if (!sb) {
    return res.status(200).render('reader', {
      error: 'Supabase URL/Key missing on server.',
      book: { title: 'Unknown', author: '' },
      epubUrl: null
    });
  }

  try {
    const { data: book, error } = await sb
      .from('curated_books')
      .select('id,title,author,cover,source_url,file_url,category')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!book) {
      return res.status(404).render('reader', {
        error: 'Book not found.',
        book: { title: 'Unknown', author: '' },
        epubUrl: null
      });
    }

    const epubUrl = book.file_url || null;

    return res.render('reader', {
      error: null,
      book,
      epubUrl
    });
  } catch (e) {
    console.error('[reader] load failed:', e);
    return res.status(500).render('reader', {
      error: e.message || 'Reader error.',
      book: { title: 'Unknown', author: '' },
      epubUrl: null
    });
  }
});

module.exports = router;
