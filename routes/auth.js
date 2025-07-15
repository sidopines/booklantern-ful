// routes/auth.js

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const sendVerificationEmail = require('../utils/sendVerification');

// Register
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.send('User already exists.');

    const newUser = new User({ name, email, password });
    const savedUser = await newUser.save();

    const token = jwt.sign({ id: savedUser._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    await sendVerificationEmail(savedUser.email, token, process.env.BASE_URL);

    res.send('✅ Registration successful. Please check your email to verify your account.');
  } catch (err) {
    console.error('Error in registration:', err);
    res.status(500).send('Server error during registration.');
  }
});

// Email Verification
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

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user || user.password !== password) return res.send('Invalid credentials.');
    if (!user.verified) return res.send('Please verify your email before logging in.');

    if (user.role === 'admin') {
      return res.redirect('/admin');
    } else {
      return res.redirect('/watch'); // subscriber dashboard
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Login failed.');
  }
});

module.exports = router;
