// models/ReadingFavorite.js
// Stores user favorites (heart button on book cards)
const mongoose = require('mongoose');

const readingFavoriteSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    bookKey: {
      type: String,
      required: true,
      trim: true
    },
    source: {
      type: String,
      trim: true,
      default: 'unknown'
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    author: {
      type: String,
      trim: true,
      default: ''
    },
    cover: {
      type: String,
      trim: true,
      default: ''
    },
    // URL to read this book
    readerUrl: {
      type: String,
      trim: true,
      default: ''
    },
    // Category/subject for recommendations
    category: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Compound index for efficient toggle operations
readingFavoriteSchema.index({ userId: 1, bookKey: 1 }, { unique: true });
// Index for listing user favorites
readingFavoriteSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ReadingFavorite', readingFavoriteSchema);
