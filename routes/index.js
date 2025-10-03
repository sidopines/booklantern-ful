// routes/index.js
const express = require('express');
const router = express.Router();

/**
 * Helper: tiny book builder so our card partial has what it needs.
 * Fields used by the card partial typically include:
 *   - title, author, cover, href
 * We point href to /read?provider=gutenberg&id=<pgId> where possible.
 */
function pg(id) {
  return {
    href: `/read?provider=gutenberg&id=${id}`,
    cover: `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
  };
}
function book({ title, author, subjects = [], href = '#', cover = null }) {
  return { title, author, subjects, href, cover };
}

/**
 * Curated rows (favor science & biography; avoid kiddie/cartoons).
 * Where there’s a well-known Project Gutenberg entry, we wire it.
 * Otherwise we still render nice meta (your card handles no-cover gracefully).
 */
const ROWS = {
  trending: [
    // Science & biography flavored
    book({ title: 'On the Origin of Species', author: 'Charles Darwin', subjects: ['Science', 'Biology'], ...pg(2009) }),
    book({ title: 'Relativity: The Special and General Theory', author: 'Albert Einstein', subjects: ['Science', 'Physics'], ...pg(30155) }),
    book({ title: 'Voyage of the Beagle', author: 'Charles Darwin', subjects: ['Travel', 'Science'], ...pg(3704) }),
    book({ title: 'The Autobiography of Benjamin Franklin', author: 'Benjamin Franklin', subjects: ['Biography', 'History'], ...pg(20203) }),
    book({ title: 'The Life of Pasteur', author: 'René Vallery-Radot', subjects: ['Biography', 'Science'], href: '#', cover: null }),
    book({ title: 'Opticks', author: 'Isaac Newton', subjects: ['Science', 'Physics'], href: '#', cover: null }),
    book({ title: 'The Problems of Philosophy', author: 'Bertrand Russell', subjects: ['Philosophy'], ...pg(5827) }),
    book({ title: 'The Interpretation of Dreams', author: 'Sigmund Freud', subjects: ['Psychology'], ...pg(15489) })
  ],

  philosophy: [
    book({ title: 'Meditations', author: 'Marcus Aurelius', subjects: ['Philosophy', 'Stoicism'], ...pg(2680) }),
    book({ title: 'Thus Spoke Zarathustra', author: 'Friedrich Nietzsche', subjects: ['Philosophy'], ...pg(1998) }),
    book({ title: 'Beyond Good and Evil', author: 'Friedrich Nietzsche', subjects: ['Philosophy'], ...pg(4363) }),
    book({ title: 'The Republic', author: 'Plato', subjects: ['Philosophy', 'Politics'], ...pg(1497) }),
    book({ title: 'The Ethics', author: 'Benedict de Spinoza', subjects: ['Philosophy'], ...pg(3800) }),
    book({ title: 'Utilitarianism', author: 'John Stuart Mill', subjects: ['Philosophy'], ...pg(11224) })
  ],

  history: [
    book({ title: 'The Histories', author: 'Herodotus', subjects: ['History'], ...pg(2707) }),
    book({ title: 'A Short History of the World', author: 'H. G. Wells', subjects: ['History'], ...pg(35461) }),
    book({ title: 'Gulliver’s Travels', author: 'Jonathan Swift', subjects: ['Satire', 'Travel'], ...pg(829) }),
    book({ title: 'The Prince', author: 'Niccolò Machiavelli', subjects: ['Politics', 'History'], ...pg(1232) }),
    book({ title: 'The Rights of Man', author: 'Thomas Paine', subjects: ['History', 'Politics'], ...pg(31270) }),
    book({ title: 'The Souls of Black Folk', author: 'W. E. B. Du Bois', subjects: ['History', 'Sociology'], ...pg(408) })
  ],
};

// Auto-compute a Science slice from everything above (unique by title).
function computeScience(rows) {
  const all = [...rows.trending, ...rows.philosophy, ...rows.history];
  const seen = new Set();
  const sci = [];
  for (const b of all) {
    const isSci =
      (b.subjects || []).some(s =>
        String(s).toLowerCase().includes('science') ||
        String(s).toLowerCase().includes('biology') ||
        String(s).toLowerCase().includes('physics')
      );
    if (isSci) {
      const key = `${b.title}::${b.author}`;
      if (!seen.has(key)) { seen.add(key); sci.push(b); }
    }
    if (sci.length >= 12) break;
  }
  // If not enough, top up with classic science titles:
  while (sci.length < 12) {
    const pad = [
      book({ title: 'The Outline of Science', author: 'J. Arthur Thomson', subjects: ['Science'], href: '#', cover: null }),
      book({ title: 'The Story of Chemistry', author: 'M. M. Pattison Muir', subjects: ['Science'], href: '#', cover: null }),
      book({ title: 'Physics and Philosophy', author: 'James Jeans', subjects: ['Science'], href: '#', cover: null })
    ];
    for (const p of pad) {
      const key = `${p.title}::${p.author}`;
      if (!sci.some(x => `${x.title}::${x.author}` === key)) sci.push(p);
      if (sci.length >= 12) break;
    }
    break;
  }
  return sci;
}

router.get('/', async (req, res) => {
  const trending   = ROWS.trending;
  const philosophy = ROWS.philosophy;
  const history    = ROWS.history;
  const science    = computeScience(ROWS);

  // Render the homepage with all rows populated.
  res.render('index', {
    pageTitle: 'Largest Online Hub of Free Books',
    pageDescription: 'Millions of free books from globally trusted libraries. One search, one clean reader.',
    trending,
    philosophy,
    history,
    science
  });
});

// Simple static pages so your top nav doesn’t 404
router.get('/about', (req, res) => {
  res.render('static', { pageTitle: 'About – BookLantern', bodyHtml: '<p>About BookLantern.</p>' });
});
router.get('/contact', (req, res) => {
  res.render('static', { pageTitle: 'Contact – BookLantern', bodyHtml: '<p>Contact us at hello@booklantern.org</p>' });
});

module.exports = router;
