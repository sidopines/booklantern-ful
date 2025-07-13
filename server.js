const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();
require('dotenv').config();

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// Models
const Video = require('./models/Video');
const Genre = require('./models/Genre');

// App settings
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => res.render('index'));
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/admin', async (req, res) => {
  const genres = await Genre.find();
  const videos = await Video.find().populate('genre');
  res.render('admin', { genres, videos });
});
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/watch', async (req, res) => {
  const genres = await Genre.find();
  const videos = await Video.find().populate('genre');
  res.render('watch', { genres, videos });
});

// Handle form submissions for admin panel
app.post('/add-video', async (req, res) => {
  const { title, url, genre } = req.body;
  await Video.create({ title, url, genre });
  res.redirect('/admin');
});

app.post('/add-genre', async (req, res) => {
  const { name } = req.body;
  await Genre.create({ name });
  res.redirect('/admin');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
