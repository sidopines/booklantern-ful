// routes/admin-users.js — minimal non-404 stub so the button works
const express = require('express');
const router = express.Router();

const ensureAdmin = require('../utils/adminGate'); // keeps this behind the gate

// Only admins past this point (your gate already exists)
router.use(ensureAdmin);

// GET /admin/users — simple placeholder page so it’s not a 404
router.get('/', async (req, res) => {
  // If you later want to list users, wire this to Supabase Admin API or your profiles table.
  res.status(200).render('admin/users', {
    title: 'Users',
    messages: { info: 'Users admin is coming soon. No actions yet.' }
  });
});

module.exports = router;
