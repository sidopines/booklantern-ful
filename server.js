require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const csrf = require('csurf');
const bcrypt = require('bcrypt');
const User = require('./models/User'); // make sure you have this Mongoose model
const app = express();

// ===== Database connection =====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('MongoDB error', err));

// ===== Middleware =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: 'sessions'
    })
  })
);

const csrfProtection = csrf();
app.use(csrfProtection);

// attach locals (so views always have these defined)
app.use((req, res, next) => {
  res.locals.messages = {};
  res.locals.success = null;
  res.locals.error = null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.user = req.session.user || null;
  next();
});

// ===== ROUTES =====

// homepage
app.get('/', (req, res) => {
  res.render('index', {
    trending: [], // TODO: fetch books
    philosophy: [],
    history: []
  });
});

// about
app.get('/about', (req, res) => {
  res.render('about');
});

// contact
app.get('/contact', (req, res) => {
  res.render('contact');
});

// ===== AUTH ROUTES =====

// login GET
app.get('/login', (req, res) => {
  res.render('login', {
    messages: req.session.messages || {},
    success: req.session.success || null,
    error: req.session.error || null,
    csrfToken: req.csrfToken(),
    next: req.query.next || ''
  });
  req.session.messages = {};
  req.session.success = null;
  req.session.error = null;
});

// login POST
app.post('/login', async (req, res) => {
  const { email, password, next } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      req.session.error = 'Invalid credentials';
      return res.redirect('/login');
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      req.session.error = 'Invalid credentials';
      return res.redirect('/login');
    }
    req.session.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin || false
    };
    req.session.success = 'Welcome back!';
    if (next) return res.redirect(next);
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error', err);
    req.session.error = 'Something went wrong';
    res.redirect('/login');
  }
});

// register GET
app.get('/register', (req, res) => {
  res.render('register', {
    messages: req.session.messages || {},
    success: req.session.success || null,
    error: req.session.error || null,
    csrfToken: req.csrfToken()
  });
  req.session.messages = {};
  req.session.success = null;
  req.session.error = null;
});

// register POST
app.post('/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  try {
    if (!name || !email || !password || !confirmPassword) {
      req.session.error = 'All fields are required';
      return res.redirect('/register');
    }
    if (password !== confirmPassword) {
      req.session.error = 'Passwords do not match';
      return res.redirect('/register');
    }
    const existing = await User.findOne({ email });
    if (existing) {
      req.session.error = 'Email already registered';
      return res.redirect('/register');
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      password: hashed,
      isAdmin: false
    });
    await user.save();
    req.session.success = 'Account created successfully. Please log in.';
    res.redirect('/login');
  } catch (err) {
    console.error('Register error', err);
    req.session.error = 'Something went wrong';
    res.redirect('/register');
  }
});

// logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ===== Dashboard =====
app.get('/dashboard', (req, res) => {
  if (!req.session.user) {
    req.session.error = 'Please log in first';
    return res.redirect('/login');
  }
  res.render('dashboard', { user: req.session.user });
});

// ===== Error Handling =====

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

// generic error handler
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error', err);
  res.status(500).render('error', { error: err });
});

// ===== Server =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
