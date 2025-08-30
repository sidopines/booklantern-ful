// scripts/resetPassword.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

(async () => {
  try {
    const [,, emailArg, newPassArg] = process.argv;
    if (!emailArg || !newPassArg) {
      console.log('Usage: node scripts/resetPassword.js "email@example.com" "newPassword"');
      process.exit(1);
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('MONGODB_URI is missing in .env');
      process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const email = String(emailArg).trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) {
      console.error('No user found with that email:', email);
      process.exit(1);
    }

    user.password = await bcrypt.hash(String(newPassArg), 12);
    await user.save();
    console.log(`✅ Password updated for ${user.email}`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
})();