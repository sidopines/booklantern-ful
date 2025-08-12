// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: {
    type: String,
    required: true,
    lowercase: true,
    unique: true // keep this; do NOT also add userSchema.index({ email: 1 })
  },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false }
}, { timestamps: true });

// IMPORTANT: Do not also call userSchema.index({ email: 1 }, { unique: true }) elsewhere.

module.exports = mongoose.model('User', userSchema);
