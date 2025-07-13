const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const Video = require('./models/Video'); // Video model
require('dotenv').config();

const app = express();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch((err) => {
  console.error('❌ MongoDB connection error:', err);
});

// Static pages
app.get('/', (req, res) => res.render('index'));
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// Watch page: Dynamic video loading
app.get('/watch', async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    const genres = [...new Set(videos.map(v => v.genre))];
    res.render('watch', { videos, genres });
  } catch (err) {
    res.status(500).send('Error loading videos.');
  }
});

// Admin Panel: View all videos
app.get('/admin', async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 });
    res.render('admin', { videos });
  } catch (err) {
    res.status(500).send('Error loading admin panel.');
  }
});

// Handle Login form POST (basic placeholder)
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  res.send(`Login attempted for ${email}`);
});

// Handle Register form POST (basic placeholder)
app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  res.send(`Registration attempted for ${name}`);
});

// Add a new video (Admin)
app.post('/admin/add-video', async (req, res) => {
  const { title, genre, youtubeUrl, thumbnail, description } = req.body;
  try {
    await Video.create({ title, genre, youtubeUrl, thumbnail, description });
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error adding video.');
  }
});

// Delete a video (Admin)
app.post('/admin/delete-video/:id', async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error deleting video.');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
