// models/Bookmark.js
const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // For local DB books
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book' },

    // For external (Archive.org) items
    archiveId: { type: String, trim: true },

    currentPage: { type: Number, default: 1 }
  },
  { timestamps: true }
);

bookmarkSchema.pre('validate', function (next) {
  if (!this.book && !this.archiveId) {
    return next(new Error('Either "book" or "archiveId" must be provided.'));
  }
  next();
});

bookmarkSchema.index(
  { user: 1, book: 1 },
  { unique: true, partialFilterExpression: { book: { $exists: true } } }
);
bookmarkSchema.index(
  { user: 1, archiveId: 1 },
  { unique: true, partialFilterExpression: { archiveId: { $exists: true } } }
);

module.exports = mongoose.model('Bookmark', bookmarkSchema);
