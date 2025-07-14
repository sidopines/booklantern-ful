// models/Video.js
const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  genre: { type: mongoose.Schema.Types.ObjectId, ref: 'Genre', required: true },
  youtubeUrl: { type: String, required: true },
  thumbnail: { type: String },
  description: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Video', videoSchema);
