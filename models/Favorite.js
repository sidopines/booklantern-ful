const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // For books you save in your own DB
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book'
    },

    // For Archive.org (or other external) items
    archiveId: {
      type: String,
      trim: true
    }
  },
  { timestamps: true }
);

/**
 * Ensure at least one of book or archiveId is present
 */
favoriteSchema.pre('validate', function (next) {
  if (!this.book && !this.archiveId) {
    return next(new Error('Either "book" or "archiveId" must be provided.'));
  }
  next();
});

/* Avoid duplicates per user */
favoriteSchema.index(
  { user: 1, book: 1 },
  { unique: true, partialFilterExpression: { book: { $exists: true } } }
);
favoriteSchema.index(
  { user: 1, archiveId: 1 },
  { unique: true, partialFilterExpression: { archiveId: { $exists: true } } }
);

module.exports = mongoose.model('Favorite', favoriteSchema);
