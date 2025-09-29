// server.js
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import session from 'express-session';
import routes from './routes/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// static assets
app.use('/public', express.static(path.join(__dirname, 'public')));

// body parsing
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// session (basic, can be upgraded later)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'booklantern-secret',
    resave: false,
    saveUninitialized: true,
  })
);

// --- SAFE DEFAULT LOCALS ---
app.use((req, res, next) => {
  const sessUser = req?.session?.user || null;

  res.locals.user = typeof res.locals.user !== 'undefined' ? res.locals.user : (sessUser || null);
  res.locals.isAuthenticated = typeof res.locals.isAuthenticated !== 'undefined'
    ? !!res.locals.isAuthenticated
    : !!(res.locals.user && (res.locals.user.id || res.locals.user.email));

  res.locals.buildId = process.env.BUILD_ID || String(Date.now());
  res.locals.pageTitle = res.locals.pageTitle || 'BookLantern';
  res.locals.pageDescription =
    res.locals.pageDescription ||
    'Millions of free books from globally trusted libraries. One clean reader.';

  next();
});

// routes
app.use('/', routes);

// error handler
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled error:', err);
  res.status(500).render('error', { error: err });
});

app.listen(PORT, () => {
  console.log(`BookLantern listening on :${PORT}`);
});
