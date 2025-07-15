// routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const sendVerificationEmail = require('../utils/sendVerification');

// Middleware to check if user is logged in
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Register Route
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

// Email Verification Route
router.get('/verify-email', async (req, res) => {
  const token = req.query.token;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) return res.send('Invalid token.');
    if (user.verified) return res.send('Email already verified.');

    user.verified = true;
    await user.save();

    res.send('🎉 Email verified! You can now log in.');
  } catch (err) {
    console.error('Verification error:', err);
    res.status(400).send('Invalid or expired token.');
  }
});

// Login Route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
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

    if (user.role === 'admin') {
      return res.redirect('/admin');
    } else {
      return res.redirect('/dashboard');
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Login failed.');
  }
});

// Change Password Route
router.post('/settings', isAuthenticated, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  try {
    const user = await User.findById(req.session.user._id);
    if (!user) return res.status(404).send("User not found");

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.send("❌ Incorrect current password");

    const hashed = await bcrypt.hash(newPassword, 12);
    user.password = hashed;
    await user.save();

    res.send("✅ Password updated successfully");
  } catch (err) {
    console.error("Error changing password:", err);
    res.status(500).send("Internal server error");
  }
});

module.exports = router;
