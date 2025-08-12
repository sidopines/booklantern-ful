// models/SiteSettings.js
const mongoose = require('mongoose');

/**
 * Singleton document that stores site-wide, admin-editable settings
 * (hero headline/subhead for homepage, and room to grow).
 *
 * We pin the _id to "singleton" so there is exactly one document.
 */
const siteSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'singleton' },

    // Homepage hero copy (editable at /admin/settings)
    heroHeadline: {
      type: String,
      default: 'Books, beautifully.',
      maxlength: 160,
      trim: true,
    },
    heroSubhead: {
      type: String,
      default:
        'Search the open stacks—Archive.org, Open Library, and Project Gutenberg. Read in a focused, book-like experience that stays out of the way.',
      maxlength: 300,
      trim: true,
    },

    // (Future) Allow toggles/flags without schema changes
    flags: {
      type: Map,
      of: Boolean,
      default: {},
    },

    // (Future) Put curated shelf presets here if you want to manage them in UI
    // shelves: [{ title: String, q: String }]
  },
  { timestamps: true }
);

/**
 * Get the singleton settings document, creating it if missing.
 * Always returns a real mongoose document (not lean).
 */
siteSettingsSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findById('singleton');
  if (!doc) {
    doc = await this.create({ _id: 'singleton' });
  }
  return doc;
};

module.exports = mongoose.model('SiteSettings', siteSettingsSchema);
