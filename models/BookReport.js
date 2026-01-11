// models/BookReport.js
// Stores user reports for books that fail to load
const mongoose = require('mongoose');

const bookReportSchema = new mongoose.Schema(
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
    // The URL that failed
    failedUrl: {
      type: String,
      trim: true,
      default: ''
    },
    // Reason category
    reason: {
      type: String,
      enum: ['no_content', 'drm_protected', 'load_error', 'wrong_format', 'other'],
      default: 'load_error'
    },
    // User-provided details
    details: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    // Book metadata for admin review
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
    source: {
      type: String,
      trim: true,
      default: 'unknown'
    },
    // Status for admin
    status: {
      type: String,
      enum: ['new', 'reviewed', 'fixed', 'wontfix'],
      default: 'new',
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Index for admin queries
bookReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('BookReport', bookReportSchema);
