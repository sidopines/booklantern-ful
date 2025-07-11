const express = require('express');
const app = express();
const path = require('path');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => res.render('index'));
app.get('/about', (req, res) => res.render('about'));
app.get('/contact', (req, res) => res.render('contact'));
app.get('/admin', (req, res) => res.render('admin'));
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  // Placeholder for login logic
  res.send(`Login attempted for ${email}`);
});

app.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  // Placeholder for registration logic
  res.send(`Registration attempted for ${name}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
