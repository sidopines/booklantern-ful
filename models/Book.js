// models/Book.js
const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true },
    creator:     { type: String },          // e.g. "Mark Twain"
    author:      { type: String },          // legacy field – keep for compatibility
    description: { type: String },

    // Archive / external source info
    archiveId:   { type: String, index: true }, // e.g. "adventuresoftoms00twai"
    sourceUrl:   { type: String },              // full URL to original source
    fromArchive: { type: Boolean, default: false },

    // Media / meta
    coverImage:  { type: String },          // custom/manual cover if you have one
    genre:       { type: String }
  },
  {
    timestamps: true,
    toJSON:    { virtuals: true },
    toObject:  { virtuals: true }
  }
);

/**
 * Virtuals
 */
bookSchema.virtual('identifier').get(function () {
  return this.archiveId || this._id?.toString();
});

bookSchema.virtual('cover').get(function () {
  if (this.coverImage) return this.coverImage;
  if (this.archiveId)  return `https://archive.org/services/img/${this.archiveId}`;
  return '';
});

module.exports = mongoose.model('Book', bookSchema);
