// models/Video.js (new file to be created)

const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  genre: {
    type: String,
    required: true,
  },
  youtubeUrl: {
    type: String,
    required: true,
  },
  thumbnail: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Video', videoSchema);
