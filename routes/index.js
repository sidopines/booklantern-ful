// routes/index.js — public site pages; safe locals to views
const express = require('express');
const router = express.Router();

const supabase = require('../supabaseAdmin'); // may be null

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

// -----------------------------
// Homepage
// -----------------------------
router.get('/', async (_req, res) => {
  // Default shelves so the page never 500s
  let shelvesList = [
    { key: 'trending',   label: 'Trending',   items: [] },
    { key: 'philosophy', label: 'Philosophy', items: [] },
    { key: 'history',    label: 'History',    items: [] },
    { key: 'science',    label: 'Science',    items: [] },
    { key: 'biographies',label: 'Biographies',items: [] },
    { key: 'religion',   label: 'Religion',   items: [] },
    { key: 'classics',   label: 'Classics',   items: [] },
  ];

  if (supabase) {
    try {
      // Pull everything the homepage might need
      const { data, error } = await supabase
        .from('video_and_curated_books_catalog')
        .select('*')
        .order('homepage_row', { ascending: true })
        .order('created_at',   { ascending: false });

      if (!error && Array.isArray(data)) {
        // Group rows by homepage_row
        const byRow = new Map();
        for (const r of data) {
          const row = Number(r.homepage_row || 0);
          if (!byRow.has(row)) byRow.set(row, []);
          byRow.get(row).push({
            id: r.id,
            title: r.title,
            author: r.author,
            cover_image: r.cover_image ?? r.cover ?? null,
            cover: r.cover ?? r.cover_image ?? null,
            source_url: r.source_url || null,
            provider: r.provider || null,
            provider_id: r.provider_id || null,
            genre_slug: r.genre_slug || null,
            genre_name: r.genre_name || null,
            created_at: r.created_at
          });
        }

        // Build shelves from those groups (keep friendly labels)
        shelvesList = [];
        for (const [row, items] of byRow.entries()) {
          const sample = items[0] || {};
          const key   = (sample.genre_slug || `row-${row}`).toLowerCase();
          const label = sample.genre_name || key.replace(/^\w/, c => c.toUpperCase());
          shelvesList.push({ key, label, items });
        }

        // Ensure deterministic order
        shelvesList.sort((a, b) => (a.key > b.key ? 1 : -1));
      }
    } catch (e) {
      // If anything goes wrong, fall back to empty default shelves
      console.error('[home] catalog fetch failed:', e.message || e);
    }
  }

  return res.render('index', { shelvesList, shelvesData: {} });
});

// -----------------------------
// Read (reader shell)
// -----------------------------
router.get('/read', (req, res) => {
  const provider = isStr(req.query.provider) ? req.query.provider : '';
  const id = isStr(req.query.id) ? req.query.id : '';
  return res.render('read', { provider, id });
});

// -----------------------------
// Static pages
// -----------------------------
router.get('/about', (_req, res) => res.render('about', {}));
router.get('/contact', (_req, res) => res.render('contact', {}));
router.get('/privacy', (_req, res) => res.render('privacy', {}));
router.get('/terms',   (_req, res) => res.render('terms', {}));

// -----------------------------
// Minimal search stub
// -----------------------------
router.get('/search', (_req, res) => res.render('search', { query: '', results: [] }));

module.exports = router;
