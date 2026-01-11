// models/ReadingProgress.js
// Stores reading progress for "Continue Reading" functionality
const mongoose = require('mongoose');

const readingProgressSchema = new mongoose.Schema(
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
    // For EPUB: CFI string; For PDF: page number as string
    lastLocation: {
      type: String,
      default: ''
    },
    // Percentage progress (0-100)
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    // Reader URL to resume reading
    readerUrl: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

// Compound index for efficient queries
readingProgressSchema.index({ userId: 1, bookKey: 1 }, { unique: true });
// Index for "Continue Reading" queries (most recent first)
readingProgressSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('ReadingProgress', readingProgressSchema);
