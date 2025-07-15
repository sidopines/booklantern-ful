const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const sendVerification = require('../utils/sendVerification');
const router = express.Router();

// REGISTER
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const hashed = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email, password: hashed });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  await sendVerification(email, token);
  res.send('Check your email for verification.');
});

// VERIFY
router.get('/verify', async (req, res) => {
  const { token } = req.query;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  await User.findByIdAndUpdate(decoded.id, { verified: true });
  res.send('✅ Email verified! You can now log in.');
});

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !user.verified) return res.send('Invalid or unverified account');

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.send('Wrong password');

  req.session.user = {
    id: user._id,
    role: user.role
  };

  // Redirect based on role
  return res.redirect(user.role === 'admin' ? '/admin' : '/dashboard');
});

module.exports = router;
