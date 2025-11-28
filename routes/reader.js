// routes/reader.js — Federated public-domain EPUB reader with proxy
const express = require('express');
const axios = require('axios');
const { ensureSubscriber } = require('../utils/gate');
const { sign, verify } = require('../utils/signing');
const supabaseAdmin = require('../supabaseAdmin');

const router = express.Router();

// GET /unified-reader?token=...
router.get('/unified-reader', ensureSubscriber, (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token parameter');
  
  try {
    const payload = verify(token);
    const readerToken = sign({
      book_id: payload.book_id,
      provider: payload.provider,
      provider_id: payload.provider_id,
      format: payload.format,
      direct_url: payload.direct_url,
    }, 600);
    
    // Determine epubUrl from payload
    const epubUrl =
      payload.direct_url ||
      payload.epub_url ||
      (payload.provider === 'gutenberg' && payload.provider_id
        ? `https://www.gutenberg.org/ebooks/${payload.provider_id}.epub3.images`
        : null);
    
    // Set epubUrl in res.locals for template access
    res.locals.epubUrl = epubUrl;
    
    return res.render('unified-reader', {
      pageTitle: payload.title || 'Reading',
      title: payload.title || 'Untitled',
      author: payload.author || 'Unknown',
      mode: 'epub',
      epubUrl,
      book: {
        title: payload.title || 'Untitled',
        author: payload.author || 'Unknown',
        cover_url: payload.cover_url || null,
        book_id: payload.book_id,
      },
      readerToken,
    });
  } catch (error) {
    console.error('[unified-reader] token error:', error.message);
    return res.status(403).send('Invalid or expired token');
  }
});

// GET /proxy/epub?token=...
router.get('/proxy/epub', ensureSubscriber, async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token parameter');
  
  try {
    const payload = verify(token);
    const directUrl = payload.direct_url;
    if (!directUrl) return res.status(404).send('No file URL available');
    
    const response = await axios({
      method: 'GET',
      url: directUrl,
      responseType: 'stream',
      timeout: 30000,
      headers: { 'User-Agent': 'BookLantern/1.0' },
    });
    
    res.set({
      'Content-Type': response.headers['content-type'] || 'application/epub+zip',
      'Cache-Control': 'private, max-age=600',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    
    if (response.headers['content-length']) {
      res.set('Content-Length', response.headers['content-length']);
    }
    
    response.data.pipe(res);
  } catch (error) {
    console.error('[proxy/epub] error:', error.message);
    if (error.message.includes('Token expired') || error.message.includes('Invalid token')) {
      return res.status(403).send('Invalid or expired token');
    }
    return res.status(500).send('Failed to fetch book');
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
