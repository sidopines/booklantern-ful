// routes/favorites.js
// Routes for favorites page and token-safe book opener
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const { ensureSubscriber } = require('../utils/gate');
const { buildReaderToken } = require('../utils/buildReaderToken');
const supabase = require('../lib/supabaseServer');

// Helper to get user ID from session
function getUserId(req) {
  return req.session?.user?.id || null;
}

// ============================================================================
// GET /favorites - Favorites page
// ============================================================================
router.get('/favorites', ensureSubscriber, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.redirect('/login?next=/favorites');
    }

    // Fetch favorites from Supabase
    const { data: items, error } = await supabase
      .from('reading_favorites')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[favorites] supabase error:', error);
      return res.status(500).render('error', {
        pageTitle: 'Error',
        statusCode: 500,
        message: 'Failed to load favorites'
      });
    }

    // Map to template format
    const favorites = (items || []).map(item => ({
      bookKey: item.book_key,
      source: item.source,
      title: item.title,
      author: item.author,
      cover: item.cover,
      readerUrl: item.reader_url,
      category: item.category,
      createdAt: item.created_at
    }));

    return res.render('favorites', {
      pageTitle: 'My Favorites',
      favorites
    });
  } catch (err) {
    console.error('[favorites] error:', err);
    return res.status(500).render('error', {
      pageTitle: 'Error',
      statusCode: 500,
      message: 'Something went wrong'
    });
  }
});

// ============================================================================
// GET /open - Token-safe book opener
// Regenerates a fresh token and redirects to unified-reader
// This ensures favorited books never expire
// ============================================================================
router.get('/open', ensureSubscriber, async (req, res) => {
  const {
    provider = 'unknown',
    provider_id,
    title = 'Untitled',
    author = '',
    cover = ''
  } = req.query;

  const ref = req.query.ref || '/read';

  // Validate required params
  if (!provider_id) {
    return res.status(400).render('error', {
      pageTitle: 'Missing Book ID',
      statusCode: 400,
      message: 'No book identifier provided. Please go back and try again.'
    });
  }

  console.log(`[open] Opening book: provider=${provider}, id=${provider_id}, title=${title}`);

  try {
    // Check if this is an archive.org book
    if (provider === 'archive' || provider_id.includes('archive.org')) {
      // Extract archive identifier
      let archiveId = provider_id;
      if (provider_id.includes('archive.org')) {
        const match = provider_id.match(/archive\.org\/details\/([^/?#]+)/);
        if (match) archiveId = match[1];
      }

      // Generate token for archive book
      const token = buildReaderToken({
        provider: 'archive',
        provider_id: archiveId,
        archive_id: archiveId,
        title: title,
        author: author,
        cover_url: cover || `https://archive.org/services/img/${archiveId}`,
        source_url: `https://archive.org/details/${archiveId}`,
        format: 'epub' // Will auto-detect in reader
      });

      const redirectUrl = `/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`;
      console.log(`[open] Archive redirect: ${archiveId}`);
      return res.redirect(redirectUrl);
    }

    // Check if this is an external/DOAB/OAPEN book (URL-based)
    if (provider === 'external' || provider === 'doab' || provider === 'oapen' ||
        provider_id.startsWith('http://') || provider_id.startsWith('https://')) {
      
      // For external books, we need to resolve the direct file URL
      // First check if we have the direct URL in the favorites
      const userId = getUserId(req);
      if (userId) {
        const { data: fav } = await supabase
          .from('reading_favorites')
          .select('*')
          .eq('user_id', userId)
          .eq('book_key', provider_id)
          .single();

        // If we have a stored reader_url with direct file, use it
        if (fav && fav.reader_url) {
          // Check if reader_url is a token-based URL or direct
          if (fav.reader_url.includes('token=')) {
            // Old token URL - regenerate
            console.log(`[open] Regenerating token for external book: ${title}`);
          }
        }
      }

      // For external books, redirect to /read with search to resolve
      // This triggers the normal external token resolution flow
      const searchQuery = `${title} ${author}`.trim();
      console.log(`[open] External book, redirecting to search: ${searchQuery}`);
      return res.redirect(`/read?q=${encodeURIComponent(searchQuery)}`);
    }

    // For other providers (gutenberg, openlibrary, etc.)
    // Generate a fresh token
    const token = buildReaderToken({
      provider: provider,
      provider_id: provider_id,
      title: title,
      author: author,
      cover_url: cover,
      format: 'epub'
    });

    const redirectUrl = `/unified-reader?token=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`;
    console.log(`[open] Standard redirect for ${provider}: ${provider_id}`);
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error('[open] error:', err);
    return res.status(500).render('error', {
      pageTitle: 'Error Opening Book',
      statusCode: 500,
      message: 'Failed to open book. Please try searching for it again.'
    });
  }
});

module.exports = router;
