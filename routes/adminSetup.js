// routes/adminSetup.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');

/**
 * One-time admin setup route:
 * Visit: /admin-setup?email=you@example.com&secret=YOUR_SECRET
 * Requires process.env.ADMIN_SETUP_SECRET to be set on the server.
 * After use, delete this file and remove its mount from server.js.
 */
router.get('/admin-setup', async (req, res) => {
  try {
    const serverSecret = process.env.ADMIN_SETUP_SECRET;
    const email = String(req.query.email || '').toLowerCase().trim();
    const provided = String(req.query.secret || '');

    if (!serverSecret) {
      return res.status(500).send('ADMIN_SETUP_SECRET is not set on the server.');
    }
    if (!email || !provided) {
      return res
        .status(400)
        .send('Usage: /admin-setup?email=you@example.com&secret=YOUR_SECRET');
    }
    if (provided !== serverSecret) {
      return res.status(403).send('Bad secret.');
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).send('No user with that email.');

    user.isAdmin = true;
    await user.save();

    return res.send(
      `✅ ${email} is now an admin. You can now go to /admin.\n\n` +
      `IMPORTANT: Delete routes/adminSetup.js and remove its mount in server.js after this.`
    );
  } catch (e) {
    console.error('admin-setup error', e);
    return res.status(500).send('Server error');
  }
});

module.exports = router;
