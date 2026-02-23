// routes/reading.js
// API routes for reading progress, favorites, events, trending, and recommendations
// Uses Supabase PostgreSQL for data storage
const express = require('express');
const router = express.Router();
const { ensureSubscriberApi } = require('../utils/gate');
const { canonicalBookKey, buildOpenUrl, extractArchiveId, normalizeMeta, isNumericOnly, stripPrefixes, bookKeyVariants, repairFavoriteMeta, stripBlPrefix, ensureRawProviderId } = require('../utils/bookHelpers');

// Supabase client for database operations
const supabase = require('../lib/supabaseServer');

// Helper to get user ID from session
function getUserId(req) {
  return req.session?.user?.id || null;
}

// ============================================================================
// READING PROGRESS ENDPOINTS
// ============================================================================

/**
 * POST /api/reading/progress
 * Save/update reading progress for a book
 * Body: { bookKey, source?, title, author?, cover?, lastLocation, progress?, readerUrl? }
 */
router.post('/progress', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const { bookKey, source, title, author, cover, lastLocation, progress, readerUrl } = req.body;
    
    if (!bookKey || !title) {
      return res.status(400).json({ ok: false, error: 'bookKey and title required' });
    }

    const progressValue = typeof progress === 'number' ? Math.min(100, Math.max(0, progress)) : 0;

    // Upsert reading progress using Supabase
    const { error } = await supabase
      .from('reading_progress_v2')
      .upsert({
        user_id: userId,
        book_key: bookKey,
        source: source || 'unknown',
        title: title,
        author: author || '',
        cover: cover || '',
        last_location: lastLocation || '',
        progress: progressValue,
        reader_url: readerUrl || '',
        updated_at: new Date().toISOString()
      }, { 
        onConflict: 'user_id,book_key',
        ignoreDuplicates: false 
      });

    if (error) {
      console.error('[reading/progress] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[reading/progress] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/**
 * GET /api/reading/continue
 * Get user's recently read books (for "Continue Reading" shelf)
 * Query: ?limit=20 (default 20, max 50)
 */
router.get('/continue', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const { data: items, error } = await supabase
      .from('reading_progress_v2')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[reading/continue] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    // Deduplicate by provider+provider_id first, then by normalized title
    const seenKeys = new Set();
    const seenTitles = new Set();
    const deduped = [];
    for (const item of (items || [])) {
      // Primary dedup: provider + book_key (provider_id)
      const providerKey = ((item.source || 'unknown') + ':' + (item.book_key || '')).toLowerCase();
      if (providerKey && providerKey !== 'unknown:' && seenKeys.has(providerKey)) continue;
      if (providerKey && providerKey !== 'unknown:') seenKeys.add(providerKey);

      // Secondary dedup: normalized title
      const canonical = (item.title || '').trim().toLowerCase();
      if (canonical && seenTitles.has(canonical)) continue;
      if (canonical) seenTitles.add(canonical);

      deduped.push(item);
    }

    return res.json({
      ok: true,
      items: deduped.map(item => {
        // Build /open URL fresh via normalized meta (never trust stored openUrl)
        const rawMeta = {
          provider: item.source,
          provider_id: item.book_key,
          title: item.title,
          author: item.author,
          cover: item.cover,
          source_url: item.reader_url
        };
        const meta = normalizeMeta(rawMeta);
        const openUrl = buildOpenUrl(meta);
        // Strip bl-book-/archive- prefixes before numeric check
        const bareKey = stripPrefixes(item.book_key) || item.book_key || '';
        const unavailable = !openUrl || isNumericOnly(bareKey);
        if (unavailable) {
          console.log(`[reading/continue] unavailable (still returned): bookKey=${item.book_key} title="${item.title}"`);
        }
        return {
          bookKey: item.book_key,
          source: item.source,
          title: item.title,
          author: item.author,
          cover: item.cover,
          lastLocation: item.last_location,
          progress: item.progress,
          readerUrl: item.reader_url,
          openUrl: openUrl || null,
          availability: unavailable ? 'unavailable' : 'ok',
          updatedAt: item.updated_at
        };
      }) // Bug B: do NOT filter — return all items
    });
  } catch (err) {
    console.error('[reading/continue] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/**
 * DELETE /api/reading/continue/:bookKey
 * Remove a specific item from Continue Reading (reading progress)
 */
router.delete('/continue/:bookKey', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const rawBookKey = req.params.bookKey;
    if (!rawBookKey) {
      return res.status(400).json({ ok: false, error: 'bookKey required' });
    }

    // Try deleting by exact key first, then by normalized variants
    const bookKey = decodeURIComponent(rawBookKey);
    const variants = new Set([bookKey]);
    const stripped = stripPrefixes(bookKey);
    if (stripped && stripped !== bookKey) {
      variants.add(stripped);
      variants.add('bl-book-' + stripped);
      variants.add('archive-' + stripped);
    }

    const { error } = await supabase
      .from('reading_progress_v2')
      .delete()
      .eq('user_id', userId)
      .in('book_key', [...variants]);

    if (error) {
      console.error('[reading/continue DELETE] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    console.log(`[reading/continue DELETE] removed bookKey=${bookKey} for user=${userId}`);
    return res.json({ ok: true, removed: true });
  } catch (err) {
    console.error('[reading/continue DELETE] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/**
 * DELETE /api/reading/continue
 * Clear ALL Continue Reading items for the current user
 */
router.delete('/continue', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const { error } = await supabase
      .from('reading_progress_v2')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('[reading/continue DELETE ALL] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    console.log(`[reading/continue DELETE ALL] cleared for user=${userId}`);
    return res.json({ ok: true, cleared: true });
  } catch (err) {
    console.error('[reading/continue DELETE ALL] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/**
 * GET /api/reading/progress/:bookKey
 * Get saved progress for a specific book
 */
router.get('/progress/:bookKey', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const { bookKey } = req.params;
    
    const { data: progress, error } = await supabase
      .from('reading_progress_v2')
      .select('*')
      .eq('user_id', userId)
      .eq('book_key', bookKey)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[reading/progress/:bookKey] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    if (!progress) {
      return res.json({ ok: true, found: false });
    }

    return res.json({
      ok: true,
      found: true,
      lastLocation: progress.last_location,
      progress: progress.progress
    });
  } catch (err) {
    console.error('[reading/progress/:bookKey] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ============================================================================
// FAVORITES ENDPOINTS
// ============================================================================

/**
 * POST /api/reading/favorite
 * Toggle favorite status for a book
 * Body: { bookKey, source?, title, author?, cover?, readerUrl?, category? }
 */
router.post('/favorite', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const { bookKey, title, author, cover, readerUrl, category } = req.body;
    let { source } = req.body;
    
    if (!bookKey || !title) {
      return res.status(400).json({ ok: false, error: 'bookKey and title required' });
    }

    // P0: Extract raw provider + provider_id from bookKey for storage
    // bookKey is bl:<provider>:<raw_id>, we need to store raw values
    let rawProviderId = bookKey;
    const blParsed = stripBlPrefix(bookKey);
    if (blParsed) {
      if (!source || source === 'unknown') source = blParsed.provider;
      rawProviderId = blParsed.rawId;
    }

    // Parse provider info from readerUrl if source is unknown (Bug A)
    if ((!source || source === 'unknown') && readerUrl) {
      const qIdx = readerUrl.indexOf('?');
      if (qIdx >= 0) {
        try {
          const params = new URLSearchParams(readerUrl.slice(qIdx + 1));
          if (params.get('provider') && params.get('provider') !== 'unknown') {
            source = params.get('provider');
          }
        } catch (_) {}
      }
    }

    // Normalize meta before persisting to fix provider=unknown / numeric IDs
    const normalized = normalizeMeta({
      provider: source || 'unknown',
      provider_id: rawProviderId,
      title,
      author: author || '',
      cover: cover || '',
      source_url: readerUrl || ''
    });
    source = normalized.provider || source || 'unknown';

    // Check if already favorited — check canonical key AND legacy variants
    const variants = bookKeyVariants(bookKey);
    const { data: existing } = await supabase
      .from('reading_favorites')
      .select('id, book_key')
      .eq('user_id', userId)
      .in('book_key', variants)
      .limit(1)
      .maybeSingle();
    
    if (existing) {
      // Remove favorite (toggle off)
      await supabase
        .from('reading_favorites')
        .delete()
        .eq('id', existing.id);
      return res.json({ ok: true, favorited: false });
    }

    // Add favorite (toggle on)
    const { error } = await supabase
      .from('reading_favorites')
      .insert({
        user_id: userId,
        book_key: bookKey,
        source: source || 'unknown',
        title: title,
        author: author || '',
        cover: cover || '',
        reader_url: readerUrl || '',
        category: category || ''
      });

    if (error) {
      console.error('[reading/favorite] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    return res.json({ ok: true, favorited: true });
  } catch (err) {
    console.error('[reading/favorite] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/**
 * GET /api/reading/favorites
 * Get user's favorited books
 * Query: ?limit=50 (default 50, max 100)
 */
router.get('/favorites', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

    const { data: items, error } = await supabase
      .from('reading_favorites')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[reading/favorites] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    return res.json({
      ok: true,
      items: (items || []).map(item => {
        // Repair favorites with unknown source on-the-fly (Bug A)
        const repaired = repairFavoriteMeta(item);
        // Build /open URL fresh from normalized meta
        // P0: Always use raw provider_id (never bookKey) for open links
        let provId = repaired._provider_id || item.book_key;
        provId = ensureRawProviderId(provId, 'reading/favorites');
        const rawMeta = {
          provider: repaired.source || item.source,
          provider_id: provId,
          title: item.title,
          author: item.author,
          cover: item.cover,
          source_url: item.reader_url,
          direct_url: repaired._direct_url || ''
        };
        const meta = normalizeMeta(rawMeta);
        const openUrl = buildOpenUrl(meta);
        const bareKey = stripPrefixes(item.book_key) || item.book_key || '';
        const unavailable = !openUrl || isNumericOnly(bareKey);
        if (unavailable) {
          console.log(`[reading/favorites] unavailable (still returned): bookKey=${item.book_key} title="${item.title}"`);
        }
        return {
          bookKey: item.book_key,
          source: repaired.source || item.source,
          title: item.title,
          author: item.author,
          cover: item.cover,
          readerUrl: item.reader_url,
          openUrl: openUrl || null,
          availability: unavailable ? 'unavailable' : 'ok',
          reason: unavailable ? 'cannot_resolve' : null,
          lastCheckedAt: new Date().toISOString(),
          category: item.category,
          createdAt: item.created_at
        };
      }) // Bug B: do NOT filter — return all favorites
    });
  } catch (err) {
    console.error('[reading/favorites] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

/**
 * GET /api/reading/favorite/:bookKey
 * Check if a specific book is favorited
 */
router.get('/favorite/:bookKey', ensureSubscriberApi, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'auth_required' });
    }

    const { bookKey } = req.params;
    const variants = bookKeyVariants(bookKey);
    const { data: existing } = await supabase
      .from('reading_favorites')
      .select('id')
      .eq('user_id', userId)
      .in('book_key', variants)
      .limit(1)
      .maybeSingle();

    return res.json({ ok: true, favorited: !!existing });
  } catch (err) {
    console.error('[reading/favorite/:bookKey] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ============================================================================
// EVENT TRACKING ENDPOINTS
// ============================================================================

/**
 * POST /api/reading/event
 * Log a reading event for trending/recommendations
 * Body: { bookKey, type, title?, author?, cover?, source?, category?, readerUrl? }
 */
router.post('/event', async (req, res) => {
  try {
    // Events can be logged even for non-logged-in users (anonymous tracking)
    const userId = getUserId(req) || 'anonymous';
    const { bookKey, type, title, author, cover, source, category, readerUrl } = req.body;
    
    if (!bookKey || !type) {
      return res.status(400).json({ ok: false, error: 'bookKey and type required' });
    }

    if (!['open', 'read_30s', 'complete'].includes(type)) {
      return res.status(400).json({ ok: false, error: 'invalid event type' });
    }

    const { error } = await supabase
      .from('reading_events')
      .insert({
        user_id: userId,
        book_key: bookKey,
        type: type,
        title: title || '',
        author: author || '',
        cover: cover || '',
        source: source || 'unknown',
        category: category || '',
        reader_url: readerUrl || ''
      });

    if (error) {
      console.error('[reading/event] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[reading/event] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ============================================================================
// TRENDING ENDPOINT
// ============================================================================

/**
 * GET /api/reading/trending
 * Get trending books based on recent events
 * Query: ?days=7&limit=20
 */
router.get('/trending', async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 7));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    // Query events from last N days and aggregate in JS
    // (Supabase doesn't support complex aggregations directly)
    const { data: events, error } = await supabase
      .from('reading_events')
      .select('*')
      .gte('created_at', cutoff.toISOString())
      .in('type', ['open', 'read_30s']);

    if (error) {
      console.error('[reading/trending] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    // Aggregate events by bookKey
    const bookScores = {};
    for (const event of (events || [])) {
      const key = event.book_key;
      if (!bookScores[key]) {
        bookScores[key] = {
          bookKey: key,
          title: event.title,
          author: event.author,
          cover: event.cover,
          source: event.source,
          readerUrl: event.reader_url,
          category: event.category,
          opens: 0,
          reads: 0
        };
      }
      if (event.type === 'open') bookScores[key].opens++;
      if (event.type === 'read_30s') bookScores[key].reads++;
    }

    // Calculate scores and sort
    const trending = Object.values(bookScores)
      .map(item => ({
        ...item,
        score: item.opens + (item.reads * 2)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return res.json({
      ok: true,
      items: trending
    });
  } catch (err) {
    console.error('[reading/trending] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ============================================================================
// RECOMMENDATIONS ENDPOINT
// ============================================================================

/**
 * GET /api/reading/recommendations
 * Get recommendations based on a book or user history
 * Query: ?bookKey=... OR just returns personalized recommendations
 * v1: same category/subject + fallback to trending
 */
router.get('/recommendations', async (req, res) => {
  try {
    const { bookKey } = req.query;
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    if (!bookKey) {
      return res.status(400).json({ ok: false, error: 'bookKey required' });
    }

    // First, get the category of the reference book from events
    const { data: sourceEvents } = await supabase
      .from('reading_events')
      .select('category, source')
      .eq('book_key', bookKey)
      .limit(1);

    const sourceCategory = sourceEvents?.[0]?.category || '';

    if (!sourceCategory) {
      // No category info, return empty recommendations
      return res.json({ ok: true, items: [], reason: 'no_category' });
    }
    // Find other popular books in the same category
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30); // Look at last 30 days

    const { data: events, error } = await supabase
      .from('reading_events')
      .select('*')
      .eq('category', sourceCategory)
      .neq('book_key', bookKey)
      .gte('created_at', cutoff.toISOString())
      .in('type', ['open', 'read_30s']);

    if (error) {
      console.error('[reading/recommendations] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    // Aggregate and score
    const bookScores = {};
    for (const event of (events || [])) {
      const key = event.book_key;
      if (!bookScores[key]) {
        bookScores[key] = {
          bookKey: key,
          title: event.title,
          author: event.author,
          cover: event.cover,
          source: event.source,
          readerUrl: event.reader_url,
          category: event.category,
          opens: 0,
          reads: 0
        };
      }
      if (event.type === 'open') bookScores[key].opens++;
      if (event.type === 'read_30s') bookScores[key].reads++;
    }

    const recommendations = Object.values(bookScores)
      .map(item => ({
        ...item,
        score: item.opens + (item.reads * 2)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return res.json({
      ok: true,
      category: sourceCategory,
      items: recommendations
    });
  } catch (err) {
    console.error('[reading/recommendations] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ============================================================================
// BOOK REPORT ENDPOINT
// ============================================================================

/**
 * POST /api/reading/report
 * Report a book that failed to load
 * Body: { bookKey, failedUrl?, reason?, details?, title?, author?, source? }
 */
router.post('/report', async (req, res) => {
  try {
    const userId = getUserId(req) || 'anonymous';
    const { bookKey, failedUrl, reason, details, title, author, source } = req.body;
    
    if (!bookKey || !reason) {
      return res.status(400).json({ ok: false, error: 'bookKey and reason required' });
    }

    const validReasons = ['no_readable_file', 'broken_link', 'access_denied', 'timeout', 'other'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ ok: false, error: 'invalid reason' });
    }

    const { error } = await supabase
      .from('book_reports')
      .insert({
        user_id: userId,
        book_key: bookKey,
        failed_url: failedUrl || '',
        reason: reason,
        details: (details || '').substring(0, 500),
        title: title || '',
        author: author || '',
        source: source || 'unknown',
        status: 'pending'
      });

    if (error) {
      console.error('[reading/report] supabase error:', error);
      return res.status(500).json({ ok: false, error: 'database_error' });
    }

    return res.json({ ok: true, message: 'Report submitted. Thank you for helping improve BookLantern!' });
  } catch (err) {
    console.error('[reading/report] error:', err);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
