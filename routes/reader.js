// routes/reader.js — Federated public-domain EPUB reader with proxy
const express = require('express');
const { ensureSubscriber } = require('../utils/gate');
const { verifyReaderToken } = require('../utils/buildReaderToken');
const supabaseAdmin = require('../supabaseAdmin');

const router = express.Router();

// GET /unified-reader?token=...&ref=...
router.get('/unified-reader', ensureSubscriber, async (req, res) => {
  try {
    const token = req.query.token;
    const refParam = req.query.ref || '/read';
    const data = verifyReaderToken(token);
    if (!data) return res.status(400).render('error', { message: 'Invalid or expired token.' });

    const epubUrl = data.direct_url ? `/proxy/epub?url=${encodeURIComponent(data.direct_url)}` : null;
    
    // Derive mode from format
    const format = data.format || 'iframe';
    const mode = format === 'epub' ? 'epub' : 'iframe';
    const backHref = refParam;

    return res.render('unified-reader', {
      title: data.title || 'Book',
      author: data.author || '',
      provider: data.provider || '',
      provider_id: data.provider_id || '',
      cover_url: data.cover_url || '',
      format,
      mode,
      direct_url: data.direct_url || '',
      epubUrl,
      backHref,
      user: req.user || null
    });
  } catch (e) {
    console.error('[unified-reader] error', e);
    return res.status(500).render('error', { message: 'Something went wrong.' });
  }
});

// POST /api/library/save
router.post('/api/library/save', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, title, author, cover_url, provider, provider_id, format, direct_url } = req.body;
    if (!book_id || !title) return res.status(400).json({ error: 'Missing required fields' });
    
    const { error } = await supabaseAdmin.from('saved_books').upsert({
      user_id: userId, book_id, title, author: author || 'Unknown', cover_url,
      provider, provider_id, format: format || 'epub', direct_url,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,book_id' });
    
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[library/save] error:', error);
    return res.status(500).json({ error: 'Failed to save book' });
  }
});

// POST /api/library/remove
router.post('/api/library/remove', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.body;
    if (!book_id) return res.status(400).json({ error: 'Missing book_id' });
    
    const { error } = await supabaseAdmin.from('saved_books').delete()
      .eq('user_id', userId).eq('book_id', book_id);
    
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[library/remove] error:', error);
    return res.status(500).json({ error: 'Failed to remove book' });
  }
});

// POST /api/reader/progress
router.post('/api/reader/progress', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, cfi, progress_percent } = req.body;
    if (!book_id || !cfi) return res.status(400).json({ error: 'Missing required fields' });
    
    const { error } = await supabaseAdmin.from('reading_progress').upsert({
      user_id: userId, book_id, cfi, progress_percent: progress_percent || 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,book_id' });
    
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[reader/progress] error:', error);
    return res.status(500).json({ error: 'Failed to save progress' });
  }
});

// GET /api/reader/progress/:book_id
router.get('/api/reader/progress/:book_id', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.params;
    const { data, error } = await supabaseAdmin.from('reading_progress').select('*')
      .eq('user_id', userId).eq('book_id', book_id).maybeSingle();
    if (error) throw error;
    return res.json(data || {});
  } catch (error) {
    console.error('[reader/progress] error:', error);
    return res.status(500).json({ error: 'Failed to get progress' });
  }
});

// POST /api/reader/bookmark
router.post('/api/reader/bookmark', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, cfi, label } = req.body;
    if (!book_id || !cfi) return res.status(400).json({ error: 'Missing required fields' });
    
    const { data, error } = await supabaseAdmin.from('bookmarks').insert({
      user_id: userId, book_id, cfi, label: label || 'Bookmark',
      created_at: new Date().toISOString(),
    }).select().single();
    
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error('[reader/bookmark] error:', error);
    return res.status(500).json({ error: 'Failed to add bookmark' });
  }
});

// GET /api/reader/bookmarks/:book_id
router.get('/api/reader/bookmarks/:book_id', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.params;
    const { data, error } = await supabaseAdmin.from('bookmarks').select('*')
      .eq('user_id', userId).eq('book_id', book_id).order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[reader/bookmarks] error:', error);
    return res.status(500).json({ error: 'Failed to get bookmarks' });
  }
});

// POST /api/reader/highlight
router.post('/api/reader/highlight', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id, cfi, text, color } = req.body;
    if (!book_id || !cfi || !text) return res.status(400).json({ error: 'Missing required fields' });
    
    const { data, error } = await supabaseAdmin.from('highlights').insert({
      user_id: userId, book_id, cfi, text, color: color || 'yellow',
      created_at: new Date().toISOString(),
    }).select().single();
    
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error('[reader/highlight] error:', error);
    return res.status(500).json({ error: 'Failed to add highlight' });
  }
});

// GET /api/reader/highlights/:book_id
router.get('/api/reader/highlights/:book_id', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { book_id } = req.params;
    const { data, error } = await supabaseAdmin.from('highlights').select('*')
      .eq('user_id', userId).eq('book_id', book_id).order('created_at', { ascending: false });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error('[reader/highlights] error:', error);
    return res.status(500).json({ error: 'Failed to get highlights' });
  }
});

// POST /api/reader/settings
router.post('/api/reader/settings', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { font_size, theme, font_family, line_height } = req.body;
    const { error } = await supabaseAdmin.from('reader_settings').upsert({
      user_id: userId, font_size, theme, font_family, line_height,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error('[reader/settings] error:', error);
    return res.status(500).json({ error: 'Failed to save settings' });
  }
});

// GET /api/reader/settings
router.get('/api/reader/settings', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not available' });
  try {
    const userId = req.session.user.id;
    const { data, error } = await supabaseAdmin.from('reader_settings').select('*')
      .eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return res.json(data || {});
  } catch (error) {
    console.error('[reader/settings] error:', error);
    return res.status(500).json({ error: 'Failed to get settings' });
  }
});

// GET /library
router.get('/library', ensureSubscriber, async (req, res) => {
  if (!supabaseAdmin) {
    return res.render('library', { pageTitle: 'My Library', books: [], error: 'Database not available' });
  }
  try {
    const userId = req.session.user.id;
    const { data: books, error } = await supabaseAdmin.from('saved_books').select('*')
      .eq('user_id', userId).order('updated_at', { ascending: false });
    if (error) throw error;
    
    const booksWithTokens = (books || []).map(book => {
      const token = sign({
        book_id: book.book_id, provider: book.provider, provider_id: book.provider_id,
        format: book.format, direct_url: book.direct_url, title: book.title,
        author: book.author, cover_url: book.cover_url,
      }, 3600);
      return { ...book, token };
    });
    
    return res.render('library', { pageTitle: 'My Library', books: booksWithTokens, error: null });
  } catch (error) {
    console.error('[library] error:', error);
    return res.render('library', { pageTitle: 'My Library', books: [], error: 'Failed to load library' });
  }
});

module.exports = router;
