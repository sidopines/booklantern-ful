// server.js

require('dotenv').config(); // Load environment variables (for local dev)

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

// ===== MONGODB CONNECTION =====
const mongoURI = process.env.MONGODB_URI;
mongoose
  .connect(mongoURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ===== MIDDLEWARE & CONFIG =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// ===== MODELS =====
const Video = require('./models/Video');
const Genre = require('./models/Genre');

// ===== ROUTES =====

app.get('/', (req, res) => res.render('index'));
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/admin', async (req, res) => {
  const genres = await Genre.find({});
  const videos = await Video.find({}).sort({ createdAt: -1 });
  res.render('admin', { genres, videos });
});
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// ===== WATCH PAGE (Dynamic) =====
app.get('/watch', async (req, res) => {
  const genreFilter = req.query.genre;
  const genres = await Genre.find({});
  let videos;
  if (genreFilter) {
    videos = await Video.find({ genre: genreFilter }).sort({ createdAt: -1 });
  } else {
    videos = await Video.find({}).sort({ createdAt: -1 });
  }
  res.render('watch', { genres, videos });
});
// ===== PLAYER PAGE (View single video) =====
app.get('/player/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).send('Video not found');
    res.render('player', { video });
  } catch (err) {
    console.error('Error loading video:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ===== AUTH (placeholder) =====
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  res.send(`Login attempted for ${email}`);
});

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  res.send(`Registration attempted for ${name}`);
});

// ===== ADMIN: ADD/DELETE VIDEO =====
app.post('/admin/add-video', async (req, res) => {
  const { title, genre, youtubeUrl, thumbnail, description } = req.body;
  try {
    if (!title || !genre || !youtubeUrl) {
      return res.send("Title, Genre, and YouTube URL are required.");
    }

    const existingGenre = await Genre.findOne({ name: genre });
    if (!existingGenre) {
      return res.send("Genre not found. Please add it first.");
    }

    await Video.create({ title, genre, youtubeUrl, thumbnail, description });
    res.redirect('/admin');
  } catch (err) {
    console.error('❌ Error adding video:', err);
    res.status(500).send("An internal server error occurred. Check server logs.");
  }
});


app.post('/admin/delete-video/:id', async (req, res) => {
  try {
    await Video.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (err) {
    console.error('Error deleting video:', err);
    res.send('Error deleting video');
  }
});

// ===== ADMIN: ADD GENRE =====
app.post('/admin/add-genre', async (req, res) => {
  const { name } = req.body;
  try {
    await Genre.create({ name });
    res.redirect('/admin');
  } catch (err) {
    console.error('Error adding genre:', err);
    res.send('Error adding genre');
  }
});

// ===== PORT =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
