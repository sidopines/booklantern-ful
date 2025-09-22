// models/Video.js
const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    href: { type: String, required: true },       // e.g. https://www.youtube.com/watch?v=xxxx
    thumbnail: { type: String, default: '' },     // e.g. https://img.youtube.com/vi/xxxx/hqdefault.jpg
    published: { type: Boolean, default: true }
  },
  {
    collection: 'videos',
    timestamps: { createdAt: true, updatedAt: true }
  }
);

module.exports = mongoose.models.Video || mongoose.model('Video', VideoSchema);
