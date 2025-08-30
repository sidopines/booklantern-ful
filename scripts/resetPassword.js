// scripts/resetPassword.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');

async function main() {
  const [,, emailArg, newPassArg] = process.argv;
  if (!emailArg || !newPassArg) {
    console.log('Usage: node scripts/resetPassword.js "<email>" "<newPassword>"');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is missing in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const user = await User.findOne({ email: String(emailArg).toLowerCase().trim() });
  if (!user) {
    console.error('No user found with that email');
    await mongoose.disconnect();
    process.exit(1);
  }

  user.password = await bcrypt.hash(String(newPassArg), 12);
  await user.save();
  console.log(`✅ Password updated for ${user.email}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
