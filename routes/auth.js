// routes/auth.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const User     = require('../models/User');
const Favorite = require('../models/Favorite');
const Book     = require('../models/Book'); // only for populate when a favorite references a local book
const sendVerificationEmail = require('../utils/sendVerification');
const sendResetEmail        = require('../utils/sendReset');

/* ---------- Config helpers ---------- */
const BASE_URL   = process.env.BASE_URL   || 'https://booklantern-ful.onrender.com';
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

/* ---------- Middleware ---------- */
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login');
}

/* ---------- Auth pages ---------- */
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

/* ---------- Register ---------- */
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const exists = await User.findOne({ email });
    if (exists) return res.send('User already exists.');

    const hashed = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      password: hashed,
      isVerified: false,
      isAdmin: false
    });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1d' });
    await sendVerificationEmail(user.email, token, BASE_URL);

    res.send('✅ Registration successful. Please check your email to verify your account.');
  } catch (err) {
    console.error('Error in registration:', err);
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

    console.log('✅ Email verified for user:', user.email);
    res.send('🎉 Email verified! You can now log in.');
  } catch (err) {
    console.error('❌ Error during email verification:', err);
    res.status(400).send('Invalid or expired token.');
  }
});

/* ---------- Login ---------- */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    console.log('🔍 User login attempt:', user);

    if (!user) return res.send('Invalid credentials.');
    if (!user.isVerified) return res.send('Please verify your email before logging in.');

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.send('Invalid credentials.');

    req.session.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role || (user.isAdmin ? 'admin' : 'user')
    };

    res.redirect(req.session.user.role === 'admin' ? '/admin' : '/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Login failed.');
  }
});

/* ---------- Logout ---------- */
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

/* ---------- Settings (GET + change password) ---------- */
router.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.session.user._id })
      .populate('book')
      .lean();

    res.render('settings', {
      pageTitle: 'Account Settings',
      pageDescription: 'Manage your BookLantern account.',
      favorites
    });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/settings', isAuthenticated, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  try {
    const user = await User.findById(req.session.user._id);
    if (!user) return res.status(404).send('User not found');

    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) return res.send('❌ Incorrect current password');

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.send('✅ Password updated successfully');
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).send('Internal server error');
  }
});

/* ---------- Dashboard ---------- */
router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.session.user._id })
      .populate('book')
      .lean();

    res.render('dashboard', {
      user: req.session.user,
      favorites,
      pageTitle: 'My Dashboard',
      pageDescription: 'Your saved books and activity.'
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Server error loading dashboard');
  }
});

/* ---------- Favorites for local Book model (optional) ---------- */
router.post('/favorite/:id', isAuthenticated, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.user._id;

  try {
    const exists = await Favorite.findOne({ user: userId, book: bookId });
    if (exists) return res.send('📚 Already in favorites');

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
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.send('Email not found');

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    await sendResetEmail(user.email, token, BASE_URL);

    res.send('✅ Reset link sent to your email');
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).send('Server error');
  }
});

router.get('/reset-password', (req, res) => {
  const token = req.query.token;
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
    if (!user) return res.send('Invalid user');

    user.password = await bcrypt.hash(password, 12);
    await user.save();

    res.send('✅ Password reset successful');
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(400).send('Invalid or expired token');
  }
});

module.exports = router;
