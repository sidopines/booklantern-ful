const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true, // only ONE unique index
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'subscriber'], default: 'subscriber' },
    createdAt: { type: Date, default: Date.now }
  },
  { collection: 'users' }
);

// Explicit unique index definition (only once)
userSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
