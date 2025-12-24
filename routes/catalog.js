// routes/catalog.js
// Local catalog search API
// Searches the Supabase catalog_books table with full-text search

const express = require('express');
const router = express.Router();

// Lazy-load supabase to allow server startup without catalog
let supabaseServer = null;
function getSupabase() {
  if (!supabaseServer) {
    try {
      supabaseServer = require('../lib/supabaseServer');
    } catch (err) {
      console.error('[catalog] Failed to load supabaseServer:', err.message);
      return null;
    }
  }
  return supabaseServer;
}

/**
 * GET /api/catalog/search?q=<query>&limit=<n>
 * 
 * Full-text search on local catalog
 * Returns results normalized to match /api/search item shape
 */
router.get('/search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 50);
    
    if (!q) {
      return res.json({ items: [], total: 0 });
    }
    
    const supabase = getSupabase();
    if (!supabase) {
      console.warn('[catalog] Supabase not available, returning empty results');
      return res.json({ items: [], total: 0, error: 'catalog_unavailable' });
    }
    
    // Use raw SQL for full-text search with ts_rank ordering
    // websearch_to_tsquery handles natural language queries better
    const { data, error } = await supabase.rpc('catalog_search', {
      search_query: q,
      result_limit: limit
    });
    
    // If RPC doesn't exist, fall back to simple ILIKE search
    if (error && error.message.includes('function') && error.message.includes('does not exist')) {
      console.log('[catalog] RPC not available, using fallback ILIKE search');
      return await fallbackSearch(supabase, q, limit, res, startTime);
    }
    
    if (error) {
      console.error('[catalog] Search error:', error.message);
      return res.status(500).json({ items: [], error: 'search_failed' });
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[catalog] hits=${data?.length || 0} elapsed=${elapsed}ms`);
    
    // Normalize results to match /api/search item shape
    const items = (data || []).map(normalizeItem);
    
    return res.json({ 
      items, 
      total: items.length,
      elapsed_ms: elapsed
    });
    
  } catch (err) {
    console.error('[catalog] Unexpected error:', err);
    return res.status(500).json({ items: [], error: 'search_failed' });
  }
});

/**
 * Fallback search using ILIKE when RPC is not available
 */
async function fallbackSearch(supabase, q, limit, res, startTime) {
  // Simple search on title, authors, subjects
  const searchPattern = `%${q}%`;
  
  const { data, error } = await supabase
    .from('catalog_books')
    .select('*')
    .or(`title.ilike.${searchPattern},authors.ilike.${searchPattern},subjects.ilike.${searchPattern}`)
    .eq('open_access', true)
    .limit(limit);
  
  if (error) {
    console.error('[catalog] Fallback search error:', error.message);
    return res.status(500).json({ items: [], error: 'search_failed' });
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`[catalog] (fallback) hits=${data?.length || 0} elapsed=${elapsed}ms`);
  
  const items = (data || []).map(normalizeItem);
  
  return res.json({ 
    items, 
    total: items.length,
    elapsed_ms: elapsed
  });
}

/**
 * Normalize a catalog_books row to match /api/search item shape
 */
function normalizeItem(row) {
  return {
    // Provider info
    provider: 'catalog',
    provider_id: row.id,
    source: row.source || 'doab',
    
    // Book metadata
    title: row.title || 'Untitled',
    author: row.authors || '',
    cover_url: null, // DOAB doesn't provide covers in OAI-PMH
    year: row.published_year || null,
    language: row.language || 'en',
    
    // Access info
    source_url: row.source_url || null,
    direct_url: null, // Catalog items link to source
    format: 'unknown', // Would need to be determined from source
    
    // Book ID for dedup
    book_id: `catalog:${row.source}:${row.source_id}`,
    
    // Catalog items are external-only (link to DOAB/source)
    external_only: true,
    readable: false,
    reason: 'catalog_reference',
    
    // Additional metadata
    subjects: row.subjects || null,
    description: row.description || null,
  };
}

/**
 * Direct search function for use by other modules (e.g., /api/search aggregator)
 */
async function searchCatalog(q, limit = 25) {
  const startTime = Date.now();
  
  try {
    if (!q || !q.trim()) {
      return { items: [], total: 0 };
    }
    
    const supabase = getSupabase();
    if (!supabase) {
      return { items: [], total: 0 };
    }
    
    // Try RPC first, fall back to ILIKE
    let data = null;
    let error = null;
    
    try {
      const result = await supabase.rpc('catalog_search', {
        search_query: q.trim(),
        result_limit: Math.min(limit, 50)
      });
      data = result.data;
      error = result.error;
    } catch (e) {
      error = e;
    }
    
    // Fallback to ILIKE if RPC fails
    if (error) {
      const searchPattern = `%${q.trim()}%`;
      const result = await supabase
        .from('catalog_books')
        .select('*')
        .or(`title.ilike.${searchPattern},authors.ilike.${searchPattern},subjects.ilike.${searchPattern}`)
        .eq('open_access', true)
        .limit(limit);
      
      data = result.data;
      error = result.error;
    }
    
    if (error) {
      console.error('[catalog] searchCatalog error:', error.message);
      return { items: [], total: 0 };
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[catalog] hits=${data?.length || 0} elapsed=${elapsed}ms`);
    
    const items = (data || []).map(normalizeItem);
    return { items, total: items.length, elapsed_ms: elapsed };
    
  } catch (err) {
    console.error('[catalog] searchCatalog unexpected error:', err);
    return { items: [], total: 0 };
  }
}

module.exports = router;
module.exports.searchCatalog = searchCatalog;
