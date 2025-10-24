// -----------------------------
// Homepage
// -----------------------------
router.get('/', async (_req, res) => {
  // Fallback labels by row if we don't have genre names yet.
  const ROW_LABELS = {
    1: 'Trending',
    2: 'Philosophy',
    3: 'History',
    4: 'Science',
    5: 'Religion',
    6: 'Classics',
    7: 'Biographies',
  };

  // How many cards per shelf to show on the homepage
  const PER_SHELF = 10;

  let shelvesList = []; // [{ key, label, items: [] }]
  if (!supabase) {
    return res.render('index', { shelvesList, shelvesData: {} });
  }

  try {
    // Pull all curated rows the homepage can use
    const { data: rows, error } = await supabase
      .from('video_and_curated_books_catalog')   // ← your view
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by homepage_row (1..7) and build shelves
    const byRow = new Map();
    for (const r of rows || []) {
      const rowNum = Number(r.homepage_row || 0);
      if (!rowNum) continue;
      if (!byRow.has(rowNum)) byRow.set(rowNum, []);
      byRow.get(rowNum).push({
        id: r.id,
        title: r.title,
        author: r.author,
        cover: r.cover_image || r.cover || null,
        cover_image: r.cover_image || r.cover || null,
        source_url: r.source_url || null,
        provider: r.provider || null,
        provider_id: r.provider_id || null,
        genre_slug: r.genre_slug || null,
        genre_name: r.genre_name || null,
        created_at: r.created_at,
      });
    }

    // Turn groups into shelves, capping list length
    shelvesList = Array.from(byRow.entries())
      .sort((a, b) => a[0] - b[0]) // 1..7
      .map(([row, items]) => {
        const label = items[0]?.genre_name || ROW_LABELS[row] || 'Shelf';
        const key = (items[0]?.genre_slug || label || `row-${row}`)
          .toString()
          .toLowerCase();
        return {
          key,
          label,
          items: items.slice(0, PER_SHELF),
        };
      });

    return res.render('index', { shelvesList, shelvesData: {} });
  } catch (e) {
    console.error('[home] failed to load shelves:', e);
    return res.render('index', { shelvesList: [], shelvesData: {} });
  }
});
