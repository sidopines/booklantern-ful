// models/ReadingEvent.js
// Lightweight event tracking for trending + recommendations
const mongoose = require('mongoose');

const readingEventSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      index: true,
      default: 'anonymous'
    },
    bookKey: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    // Event type: 'open', 'read_30s', 'complete'
    type: {
      type: String,
      required: true,
      enum: ['open', 'read_30s', 'complete'],
      index: true
    },
    // Book metadata for trending display
    title: {
      type: String,
      trim: true,
      default: ''
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
    source: {
      type: String,
      trim: true,
      default: 'unknown'
    },
    // Category/subject for recommendations
    category: {
      type: String,
      trim: true,
      default: ''
    },
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

// Index for trending queries (recent events by book)
readingEventSchema.index({ bookKey: 1, createdAt: -1 });
// Index for time-based trending (last N days)
readingEventSchema.index({ createdAt: -1 });
// Index for user's reading history (recommendations)
readingEventSchema.index({ userId: 1, createdAt: -1 });
// Compound for category-based recommendations
readingEventSchema.index({ category: 1, createdAt: -1 });

module.exports = mongoose.model('ReadingEvent', readingEventSchema);
