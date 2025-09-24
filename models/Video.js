// models/Video.js
const mongoose = require('mongoose');

if (mongoose.models.Video) {
  module.exports = mongoose.models.Video;
  return;
}

const VideoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    provider: { type: String, enum: ['youtube'], default: 'youtube', index: true },
    videoId: { type: String, required: true, trim: true, index: true }, // e.g., dQw4w9WgXcQ
    thumbnail: { type: String, trim: true }, // optional override
    description: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    isPublic: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const Video = mongoose.model('Video', VideoSchema);
module.exports = Video;
