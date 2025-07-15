const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
  },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  verified: { type: Boolean, default: false },
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
  bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
});

module.exports = mongoose.model('User', userSchema);
