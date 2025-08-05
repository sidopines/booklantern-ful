// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Favorite = require('../models/Favorite');
const Book = require('../models/Book'); // used for dashboard/favorites populate
const sendVerificationEmail = require('../utils/sendVerification');
const sendResetEmail = require('../utils/sendReset');

/* ---------- Config ---------- */
const BASE_URL             = process.env.BASE_URL             || 'http://localhost:10000';
const JWT_SECRET           = process.env.JWT_SECRET           || 'please_change_this_secret';
const ADMIN_SETUP_SECRET   = process.env.ADMIN_SETUP_SECRET   || ''; // set to enable /admin/setup
console.log('ADMIN_SETUP_SECRET is:', ADMIN_SETUP_SECRET);
const BACKDOOR_ADMIN_EMAIL = process.env.BACKDOOR_ADMIN_EMAIL || '';
const BACKDOOR_ADMIN_PASSWORD = process.env.BACKDOOR_ADMIN_PASSWORD || '';

/* ---------- Helpers ---------- */
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}
function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

/* ---------- Views ---------- */
router.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login | BookLantern',
    pageDescription: 'Access your BookLantern account to read books, watch content, and manage your favorites.'
  });
});

router.get('/register', (req, res) => {
  res.render('register', {
    pageTitle: 'Register | BookLantern',
    pageDescription: 'Create your free BookLantern account to explore books and videos.'
  });
});

router.get('/resend-verification', (req, res) => {
  // optionally prefill email via query: ?email=…
  res.render('resend-verification', {
    pageTitle: 'Resend Verification',
    pageDescription: 'Request a new email verification link.',
    email: req.query.email || ''
  });
});

/* ---------- Admin bootstrap (backdoor) ---------- */
/**
 * GET /admin/setup?secret=…
 * Upserts a verified admin user with the BACKDOOR_ADMIN_EMAIL/PASSWORD.
 */
router.get('/admin/setup', async (req, res) => {
  const { secret } = req.query;
  if (!ADMIN_SETUP_SECRET || secret !== ADMIN_SETUP_SECRET) {
    return res.status(403).send('Forbidden');
  }
  if (!BACKDOOR_ADMIN_EMAIL || !BACKDOOR_ADMIN_PASSWORD) {
    return res
      .status(500)
      .send('Missing BACKDOOR_ADMIN_EMAIL or BACKDOOR_ADMIN_PASSWORD in env');
  }

  const email = normalizeEmail(BACKDOOR_ADMIN_EMAIL);
  try {
    const hashed = await bcrypt.hash(BACKDOOR_ADMIN_PASSWORD, 12);
    const update = {
      name:  'Site Admin',
      email,
      password: hashed,
      isVerified: true,
      isAdmin: true
    };
    const user = await User.findOneAndUpdate(
      { email },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.send(`✅ Admin user ensured: ${user.email}`);
  } catch (err) {
    console.error('Admin setup error:', err);
    res.status(500).send('Failed to setup admin');
  }
});

/* ---------- Registration ---------- */
router.post('/register', async (req, res) => {
  const { name, email: rawEmail, password } = req.body;
  const email = normalizeEmail(rawEmail);
  try {
    if (await User.findOne({ email })) {
      return res.send('User already exists.');
    }
    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name || 'Unnamed',
      email,
      password: hashed,
      isVerified: false,
      isAdmin: false
    });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });
    await sendVerificationEmail(user.email, token, BASE_URL);

    res.send('✅ Registration complete! Please check your email to verify your account.');
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).send('Server error during registration.');
  }
});

/* ---------- Email verification ---------- */
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.send('Invalid token.');
    if (user.isVerified) return res.send('Email already verified.');

    user.isVerified = true;
    await user.save();
    res.send('🎉 Email verified! You can now log in.');
  } catch (err) {
    console.error('Verification error:', err);
    res.status(400).send('Invalid or expired token.');
  }
});

/* ---------- Resend verification ---------- */
router.post('/resend-verification', async (req, res) => {
  const email = normalizeEmail(req.body.email || '');
  try {
    const user = await User.findOne({ email });
    if (!user) return res.send('Email address not found.');
    if (user.isVerified) return res.send('Your email is already verified.');

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });
    await sendVerificationEmail(user.email, token, BASE_URL);
    res.send('✅ New verification link sent.');
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).send('Server error while resending verification.');
  }
});

/* ---------- Login / Logout ---------- */
router.post('/login', async (req, res) => {
  const { email: rawEmail, password } = req.body;
  const email = normalizeEmail(rawEmail);
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.send('Invalid credentials.');
    }
    if (!user.isVerified && !user.isAdmin) {
      return res.send(
        `Please verify your email before logging in. 
         <a href="/resend-verification?email=${encodeURIComponent(email)}">
           Resend verification email
         </a>`
      );
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send('Invalid credentials.');

    req.session.user = {
      _id:  user._id,
      name: user.name,
      email: user.email,
      role:  user.isAdmin ? 'admin' : 'user'
    };
    res.redirect(user.isAdmin ? '/admin' : '/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Login failed.');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

/* ---------- Settings (password + favorites) ---------- */
router.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const favorites = await Favorite
      .find({ user: req.session.user._id })
      .populate('book')
      .lean();
    res.render('settings', {
      pageTitle: 'Account Settings',
      pageDescription: 'Manage your BookLantern account.',
      favorites
    });
  } catch (err) {
    console.error('Settings load error:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/settings', isAuthenticated, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
    const user = await User.findById(req.session.user._id);
    if (!user) return res.status(404).send('User not found.');

    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) return res.send('❌ Incorrect current password');

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.send('✅ Password updated successfully');
  } catch (err) {
    console.error('Settings change error:', err);
    res.status(500).send('Internal server error');
  }
});

/* ---------- Dashboard ---------- */
router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const favorites = await Favorite
      .find({ user: req.session.user._id })
      .populate('book')
      .lean();
    res.render('dashboard', {
      user:      req.session.user,
      favorites,
      pageTitle: 'My Dashboard',
      pageDescription: 'Your saved books and activity.'
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Server error loading dashboard');
  }
});

/* ---------- Favorites (add/remove) ---------- */
router.post('/favorite/:id', isAuthenticated, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.user._id;
  try {
    if (await Favorite.exists({ user: userId, book: bookId })) {
      return res.send('📚 Already in favorites');
    }
    await Favorite.create({ user: userId, book: bookId });
    res.send('✅ Added to favorites');
  } catch (err) {
    console.error('Favorite add error:', err);
    res.status(500).send('Server error');
  }
});

router.post('/favorite/:id/remove', isAuthenticated, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.user._id;
  try {
    await Favorite.findOneAndDelete({ user: userId, book: bookId });
    res.send('🗑️ Removed from favorites');
  } catch (err) {
    console.error('Favorite remove error:', err);
    res.status(500).send('Server error');
  }
});

/* ---------- Forgot / Reset Password ---------- */
router.get('/forgot-password', (req, res) => {
  res.render('forgot-password', {
    pageTitle: 'Forgot Password',
    pageDescription: 'Reset your BookLantern password.'
  });
});

router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body.email || '');
  try {
    const user = await User.findOne({ email });
    // always respond success to avoid email enumeration
    if (user) {
      const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
      await sendResetEmail(user.email, token, BASE_URL);
    }
    res.send('✅ If that email exists, a reset link was sent.');
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).send('Server error');
  }
});

router.get('/reset-password', (req, res) => {
  const token = req.query.token || '';
  res.render('reset-password', {
    token,
    pageTitle: 'Reset Password',
    pageDescription: 'Choose a new password for your account.'
  });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.send('Invalid user.');

    user.password = await bcrypt.hash(password, 12);
    await user.save();
    res.send('✅ Password reset successful');
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(400).send('Invalid or expired token');
  }
});

module.exports = router;
