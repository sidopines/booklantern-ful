// routes/index.js
const express = require('express');
const router = express.Router();
const sendContactEmail = require('../utils/sendContactEmail');

// Home
router.get('/', (req, res) => {
  res.render('index');
});

// About
router.get('/about', (req, res) => {
  res.render('about');
});

// Contact - GET
router.get('/contact', (req, res) => {
  res.render('contact', { success: null, error: null });
});

// Contact - POST
router.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;
  try {
    await sendContactEmail(name, email, message);
    res.render('contact', { success: '✅ Your message has been sent successfully!', error: null });
  } catch (err) {
    console.error('Contact form error:', err);
    res.render('contact', { error: '❌ Failed to send message. Please try again.', success: null });
  }
});

module.exports = router;
