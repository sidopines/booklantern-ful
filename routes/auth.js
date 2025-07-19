// routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Book = require('../models/Book');
const Favorite = require('../models/Favorite');
const sendVerificationEmail = require('../utils/sendVerification');
const sendResetEmail = require('../utils/sendReset');

// ===== MIDDLEWARE =====
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login');
}

// ===== SHOW LOGIN FORM =====
router.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login | BookLantern',
    pageDescription: 'Access your BookLantern account to read books, watch content, and manage your favorites.'
  });
});

// ===== SHOW REGISTER FORM =====
router.get('/register', (req, res) => {
  res.render('register', {
    pageTitle: 'Register',
    pageDescription: 'Create your free BookLantern account to explore books and videos.'
  });
});

// ===== REGISTER USER =====
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.send('User already exists.');

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({ name, email, password: hashedPassword });
    const savedUser = await newUser.save();

    const token = jwt.sign({ id: savedUser._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    await sendVerificationEmail(savedUser.email, token, process.env.BASE_URL);

    res.send('✅ Registration successful. Please check your email to verify your account.');
  } catch (err) {
    console.error('Error in registration:', err);
    res.status(500).send('Server error during registration.');
  }
});

// ===== EMAIL VERIFICATION =====
router.get('/verify-email', async (req, res) => {
  const token = req.query.token;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) return res.send('Invalid token.');
    if (user.verified) return res.send('Email already verified.');

    user.verified = true;
    await user.save();

    console.log('✅ Email verified for user:', user.email);
    res.send('🎉 Email verified! You can now log in.');
  } catch (err) {
    console.error('❌ Error during email verification:', err);
    res.status(400).send('Invalid or expired token.');
  }
});

// ===== LOGIN USER =====
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    console.log('🔍 Login attempt for:', email);
    console.log('🔎 user.verified:', user?.verified);

    if (!user) return res.send('Invalid credentials.');
    if (!user.verified) return res.send('Please verify your email before logging in.');

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.send('Invalid credentials.');

    req.session.user = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    return res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Login failed.');
  }
});

// ===== CHANGE PASSWORD =====
router.post('/settings', isAuthenticated, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  try {
    const user = await User.findById(req.session.user._id);
    if (!user) return res.status(404).send('User not found');

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.send('❌ Incorrect current password');

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.send('✅ Password updated successfully');
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).send('Internal server error');
  }
});

// ===== USER DASHBOARD =====
router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.session.user._id }).populate('book');
    res.render('dashboard', { user: req.session.user, favorites });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Server error loading dashboard');
  }
});

// ===== ADD TO FAVORITES =====
router.post('/favorite/:id', isAuthenticated, async (req, res) => {
  const bookId = req.params.id;
  const userId = req.session.user._id;

  try {
    const already = await Favorite.findOne({ user: userId, book: bookId });
    if (already) return res.send('📚 Already in favorites');

    await Favorite.create({ user: userId, book: bookId });
    res.send('✅ Added to favorites');
  } catch (err) {
    console.error('Favorite add error:', err);
    res.status(500).send('Server error');
  }
});

// ===== REMOVE FROM FAVORITES =====
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

// ===== FORGOT PASSWORD (SEND RESET EMAIL) =====
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

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    await sendResetEmail(user.email, token, process.env.BASE_URL);

    res.send('✅ Reset link sent to your email');
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).send('Server error');
  }
});

// ===== RESET PASSWORD =====
router.get('/reset-password', (req, res) => {
  const token = req.query.token;
  res.render('reset-password', { token });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
