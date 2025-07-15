// server.js

require('dotenv').config(); // Load environment variables

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const authRoutes = require('./routes/auth');

const app = express();

// ===== MONGODB CONNECTION =====
const mongoURI = process.env.MONGODB_URI;
mongoose
  .connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ===== MIDDLEWARE & CONFIG =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== SESSION CONFIGURATION =====
app.use(
  session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } // 1 day
  })
);

// ===== MODELS =====
const Video = require('./models/Video');
const Genre = require('./models/Genre');
const Book = require('./models/Book');

// ===== ROUTES =====
app.use('/', authRoutes); // Login/Register/Email verify

// Static Pages
app.get('/', (req, res) => res.render('index'));
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

// ===== ADMIN PANEL =====
app.get('/admin', async (req, res) => {
  const genres = await Genre.find({});
  const videos = await Video.find({}).populate('genre').sort({ createdAt: -1 });
  res.render('admin', { genres, videos });
});

// ===== WATCH PAGE =====
app.get('/watch', async (req, res) => {
  const genreFilter = req.query.genre;
  const genres = await Genre.find({});
  let videos;

  if (genreFilter) {
    videos = await Video.find({ genre: genreFilter }).populate('genre').sort({ createdAt: -1 });
  } else {
    videos = await Video.find({}).populate('genre').sort({ createdAt: -1 });
  }

  res.render('watch', { genres, videos });
});

// ===== PLAYER PAGE =====
app.get('/player/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('genre');
    if (!video) return res.status(404).send('Video not found');
    res.render('player', { video });
  } catch (err) {
    console.error('Error loading video:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ===== READ PAGE (List all books) =====
app.get('/read', async (req, res) => {
  try {
    const books = await Book.find({}).sort({ createdAt: -1 });
    res.render('read', { books });
  } catch (err) {
    console.error('Error loading books:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ===== SINGLE BOOK VIEWER =====
app.get('/read/book/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).send('Book not found');
    res.render('book-viewer', { book });
  } catch (err) {
    console.error('Error loading book:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ===== ADMIN: ADD VIDEO =====
app.post('/admin/add-video', async (req, res) => {
  const { title, genre, youtubeUrl, thumbnail, description } = req.body;
  try {
    if (!title || !genre || !youtubeUrl) {
      return res.send("Title, Genre, and YouTube URL are required.");
    }

    await Video.create({ title, genre, youtubeUrl, thumbnail, description });
    res.redirect('/admin');
  } catch (err) {
    console.error('❌ Error adding video:', err);
    res.status(500).send("An internal server error occurred. Check server logs.");
  }
});

// ===== ADMIN: DELETE VIDEO =====
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
