// routes/index.js
const express = require('express');
const router = express.Router();

/** helpers */
function pageVars(req, extra = {}) {
  return {
    // nav/session
    isAuthenticated: !!req.user,
    user: req.user || null,

    // basic meta defaults (can be overridden per page)
    pageTitle: 'BookLantern',
    pageDescription:
      'Millions of free books from globally trusted libraries. One search, one clean reader.',

    // utilities for partials
    canonicalUrl: req.protocol + '://' + req.get('host') + req.originalUrl,
    referrer: req.get('referer') || '/',
    ...extra
  };
}

/** home */
router.get('/', (req, res) => {
  res.render('index', pageVars(req));
});

/** simple content pages already in your repo */
router.get('/about', (req, res) => {
  res.render('about', pageVars(req, { pageTitle: 'About • BookLantern' }));
});

router.get('/contact', (req, res) => {
  res.render('contact', pageVars(req, { pageTitle: 'Contact • BookLantern' }));
});

/** NEW: stub pages so links stop 404’ing */
router.get('/read', (req, res) => {
  res.render('read', pageVars(req, { pageTitle: 'Read • BookLantern' }));
});

router.get('/watch', (req, res) => {
  res.render('watch', pageVars(req, { pageTitle: 'Watch • BookLantern' }));
});

router.get('/login', (req, res) => {
  res.render('login', pageVars(req, { pageTitle: 'Login • BookLantern' }));
});

router.get('/register', (req, res) => {
  res.render('register', pageVars(req, { pageTitle: 'Create account • BookLantern' }));
});

/** 404 (keep at bottom) */
router.use((req, res) => {
  res.status(404).render('404', pageVars(req, { pageTitle: '404 • BookLantern' }));
});

module.exports = router;
