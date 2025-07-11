const express = require('express');
const session = require('express-session');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();

// Load environment variables

const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASS || 'admin123';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your_default_secret',
  resave: false,
  saveUninitialized: false
}));

// Middleware to check if user is logged in
function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (email === adminEmail && password === adminPassword) {
    req.session.loggedIn = true;
    req.session.email = email;
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Invalid credentials' });
  }
});

app.get('/admin', requireLogin, (req, res) => {
  res.render('admin');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ✅ Required for Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
