// routes/index.js
const express = require('express');
const router = express.Router();

/**
 * EXPECTED SHAPE of a "book" item in the pool (best-effort; lenient):
 * {
 *   id: String,
 *   provider: "openlibrary" | "gutenberg" | "internetarchive" | "loc" | "other",
 *   title: String,
 *   author: String,
 *   subjects: [String, ...],
 *   cover: "https://…", // direct image URL
 *   popularity: Number, // optional
 *   year: Number        // optional
 * }
 *
 * We source from one of:
 * - app.locals.catalog           (preferred: a big pool already fetched)
 * - app.locals.homeData.{…}      (named shelves provided by backend process)
 * - app.locals.books             (legacy)
 * If none exist, we fall back to empty arrays (page renders with friendly empties).
 */

// ----------------------- Helpers -----------------------

const BAD_COVER_PATTERNS = [
  // IA service badges / generic placeholders
  /\/services\/img\//i,
  /\/booklantern-placeholder(\.svg|\.png)?$/i,
  /\/spacer\.(gif|png|svg)$/i
];

function hasRealCover(url) {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !BAD_COVER_PATTERNS.some(rx => rx.test(url));
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function normKey(book) {
  const t = normalize(book.title).replace(/\b(a\s+history\s+of|collected\s+works|selected\s+works)\b/g, '').trim();
  const a = normalize(book.author).replace(/\b(translator|editor)\b/g, '').trim();
  return `${t}|${a}`;
}

function dedupe(list, max) {
  const seen = new Set();
  const out = [];
  for (const b of list) {
    const key = normKey(b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
    if (max && out.length >= max) break;
  }
  return out;
}

const SUBJECT_WEIGHTS = {
  // Philosophy
  philosophy: 3, ethics: 2, metaphysics: 2, stoicism: 3, 'ancient philosophy': 2,
  // History
  history: 3, 'world history': 2, biography: 1, 'historical': 1,
  // Science
  science: 3, physics: 3, chemistry: 3, biology: 3, astronomy: 3, mathematics: 2,
  geology: 2, ecology: 2, 'computer science': 3, engineering: 2,
};

function subjectScore(book, bucket) {
  const subs = Array.isArray(book.subjects) ? book.subjects : [];
  let score = 0;
  for (const s of subs) {
    const key = normalize(s);
    const w = SUBJECT_WEIGHTS[key] || 0;
    score += w;
    if (bucket && key.includes(bucket)) score += 1; // small bias toward the bucket keyword
  }
  return score;
}

// prefer recognizable editions (when year present), otherwise popularity, then fallback
function sortByQuality(list) {
  return [...list].sort((a, b) => {
    const popA = a.popularity ?? 0;
    const popB = b.popularity ?? 0;
    const yearA = a.year ?? 0;
    const yearB = b.year ?? 0;
    // newer first, then popularity, then title
    if (yearB !== yearA) return yearB - yearA;
    if (popB !== popA) return popB - popA;
    return normalize(a.title).localeCompare(normalize(b.title));
  });
}

function filterQuality(pool) {
  return pool.filter(b =>
    b &&
    b.title &&
    b.author &&
    hasRealCover(b.cover)
  );
}

function pickBySubject(pool, bucketWords, size, used) {
  const words = Array.isArray(bucketWords) ? bucketWords : [bucketWords];
  const withScore = pool
    .map(b => ({ b, s: subjectScore(b, words[0]) }))
    .filter(({ b, s }) => s > 0 && !used.has(b.id || normKey(b)));

  const sorted = sortByQuality(withScore).map(x => x.b);
  return takeWithDiversity(sorted, size, used);
}

function takeWithDiversity(list, size, used, providerSpread = true) {
  const out = [];
  const seenP = new Map(); // provider -> count
  for (const b of list) {
    const key = b.id || normKey(b);
    if (used.has(key)) continue;
    if (providerSpread) {
      const p = b.provider || 'other';
      const count = seenP.get(p) || 0;
      if (count > Math.max(0, Math.floor(out.length / 3))) {
        // too many from same provider early; skip for now
        continue;
      }
      seenP.set(p, count + 1);
    }
    out.push(b);
    used.add(key);
    if (out.length >= size) break;
  }
  return out;
}

function pickTrending(pool, size, used) {
  // Trending = quality + variety (not just subject-driven)
  const quality = sortByQuality(pool);
  return takeWithDiversity(quality, size, used);
}

// ----------------------- Route -----------------------

router.get('/', (req, res, next) => {
  try {
    // Source pool(s)
    const locals = req.app.locals || {};
    let pool =
      (Array.isArray(locals.catalog) && locals.catalog) ||
      (Array.isArray(locals.books) && locals.books) ||
      [];

    // If backend already provided named shelves, merge them into the pool
    if (locals.homeData && typeof locals.homeData === 'object') {
      const all = []
        .concat(locals.homeData.trending || [])
        .concat(locals.homeData.philosophy || [])
        .concat(locals.homeData.history || [])
        .concat(locals.homeData.science || []);
      pool = pool.concat(all);
    }

    // Quality filter first
    pool = filterQuality(pool);

    // Build shelves, ensuring uniqueness across the whole page
    const USED = new Set();

    const science = pickBySubject(pool, ['science', 'physics', 'astronomy', 'biology', 'chemistry'], 12, USED);
    const philosophy = pickBySubject(pool, ['philosophy', 'ethics', 'stoicism'], 12, USED);
    const history = pickBySubject(pool, ['history', 'biography'], 12, USED);
    const trending = pickTrending(pool, 12, USED);

    // Collage for hero (always available, unique too)
    const collagePool = pool.filter(b => !USED.has(b.id || normKey(b)));
    const collageBooks = dedupe(collagePool, 10);

    res.render('index', {
      pageTitle: 'Largest Online Hub of Free Books',
      pageDescription: 'Millions of free books from globally trusted libraries. One search, one clean reader.',
      shelves: { trending, philosophy, history, science },
      collageBooks,
    });
  } catch (err) {
    console.error('🔥 Unhandled error:', err);
    res.status(500).render('error', { message: 'Something went wrong' });
  }
});

module.exports = router;
