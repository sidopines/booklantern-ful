// models/SiteSettings.js
const mongoose = require('mongoose');

const siteSettingsSchema = new mongoose.Schema({
  // Homepage hero copy (editable by Admin)
  heroHeadline: {
    type: String,
    default: 'Books, beautifully.',
    trim: true,
  },
  heroSubhead: {
    type: String,
    default: 'Search the open stacks—Archive.org, Open Library, and Project Gutenberg. Read in a focused, book-like experience that stays out of the way.',
    trim: true,
  },

  // Reserved for future Admin customization (leave here; harmless defaults)
  // e.g., gateGuests: { type: Boolean, default: true },
  // featuredOverride: [ { identifier, title, ... } ],
}, { timestamps: true });

/**
 * Singleton helper:
 * Always return exactly one document. If none exists, create with defaults.
 */
siteSettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({});
  if (!doc) {
    doc = await this.create({});
  }
  return doc;
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
