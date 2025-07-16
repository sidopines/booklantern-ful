// routes/index.js
const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', {
    pageTitle: 'Home',
    pageDescription: 'Discover free books and knowledge on BookLantern.'
  });
});

router.get('/about', (req, res) => {
  res.render('about', {
    pageTitle: 'About',
    pageDescription: 'Learn more about BookLantern\'s mission to make books accessible.'
  });
});

router.get('/contact', (req, res) => {
  res.render('contact', {
    pageTitle: 'Contact',
    pageDescription: 'Get in touch with the BookLantern team.'
  });
});

module.exports = router;
