/** server.js — resilient boot with optional Mongo + admin video manager */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const csrf = require('csurf');
const NodeCache = require('node-cache');
const fetch = global.fetch || ((...args) => import('node-fetch').then(m => m.default(...args)));

const app = express();

// ---------- Env ----------
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const PROD = NODE_ENV === 'production';
const MONGODB_URI = process.env.MONGODB_URI || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';
const buildId = process.env.BUILD_ID || Date.now().toString(36);

// ---------- Views & static ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '7d' : 0 }));

// ---------- Middleware ----------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "https://covers.openlibrary.org", "https://i.ytimg.com", "https://img.youtube.com", "https://images.unsplash.com"],
        "connect-src": ["'self'", "https://openlibrary.org", "https://covers.openlibrary.org"],
        "frame-src": ["'self'", "https://www.youtube.com", "https://player.vimeo.com"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(compression());
app.use(morgan(PROD ? 'combined' : 'dev'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// ---------- Sessions ----------
let sessionStore;
if (MONGODB_URI) {
  try {
    sessionStore = MongoStore.create({ mongoUrl: MONGODB_URI, collectionName: 'sessions', ttl: 60 * 60 * 24 * 14 });
    console.log('🗄️  Session store: MongoStore');
  } catch (e) {
    console.warn('⚠️  Failed to init MongoStore; using MemoryStore:', e.message);
  }
} else {
  console.warn('⚠️  MONGODB_URI missing; using MemoryStore.');
}
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD }
}));

// ---------- CSRF & locals ----------
const csrfProtection = csrf({ cookie: false });
app.use((req, res, next) => {
  res.locals.buildId = buildId;
  res.locals.loggedIn = !!req.session.user;
  res.locals.user = req.session.user || null;
  next();
});

// ---------- Optional Mongoose/User (if available) ----------
let mongoose, User, dbReady = false;
(async () => {
  if (!MONGODB_URI) return;
  try {
    mongoose = require('mongoose');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    User = require('./models/User'); // must expose user.isAdmin boolean
    dbReady = true;
  } catch (err) {
    console.error('❌ MongoDB connection failed; continuing without auth:', err.message);
  }
})();

// ---------- Open Library helpers ----------
const cache = new NodeCache({ stdTTL: 3600 });
function pick(v, f=''){ return (v===undefined||v===null)?f:v; }
function normalizeOL(doc){
  const title = pick(doc.title);
  const author = (doc.author_name && doc.author_name[0]) || '';
  const key = doc.key || '';
  let openLibraryId = doc.cover_edition_key || (doc.edition_key && doc.edition_key[0]) || '';
  let cover = '';
  if (doc.cover_i) cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  else if (openLibraryId) cover = `https://covers.openlibrary.org/b/olid/${openLibraryId}-L.jpg`;
  return { id: key||openLibraryId||title, title, author, href: key ? `https://openlibrary.org${key}` : '', cover };
}
async function searchOL(q, limit=36){
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${limit}`;
  const r = await fetch(url, { headers: { 'user-agent': 'BookLantern/1.0' } });
  if (!r.ok) throw new Error(`OL ${r.status}`);
  const j = await r.json();
  return (j.docs||[]).map(normalizeOL);
}
async function seededShelf(queries, per=12){
  const rs = await Promise.all(queries.map(q=>searchOL(q, per)));
  const flat = rs.flat().filter(Boolean);
  const seen = new Set(); const out=[];
  for (const it of flat){
    const k = it.id || `${it.title}|${it.author}`;
    if (!seen.has(k)){ seen.add(k); out.push(it); }
    if (out.length>=per) break;
  }
  return out;
}

// ---------- Routes ----------
app.get('/', csrfProtection, async (req,res,next)=>{
  try{
    let payload = cache.get('home');
    if(!payload){
      const [tr,ph,hi] = await Promise.all([
        seededShelf(['classic literature','popular public domain'],12),
        seededShelf(['philosophy','ethics','political philosophy'],12),
        seededShelf(['world history','ancient history','biography'],12)
      ]);
      payload = { trending: tr, philosophy: ph, history: hi };
      cache.set('home', payload);
    }
    res.render('index', { trending: payload.trending, philosophy: payload.philosophy, history: payload.history, csrfToken: req.csrfToken() });
  }catch(err){ next(err); }
});

app.get('/read', csrfProtection, async (req,res,next)=>{
  try{
    const q = (req.query.q||'').trim();
    let results = [];
    if (q){
      const key = `read:${q.toLowerCase()}`;
      results = cache.get(key) || await searchOL(q, 36);
      cache.set(key, results);
    }
    res.render('read', { q, results, csrfToken: req.csrfToken() });
  }catch(err){ next(err); }
});

// Watch page (reads data/videos.json)
app.get('/watch', csrfProtection, (req,res)=>{
  const f = path.join(__dirname,'data','videos.json');
  let videos = [];
  if (fs.existsSync(f)){
    try { const raw = JSON.parse(fs.readFileSync(f,'utf8')); videos = Array.isArray(raw)? raw : (raw.videos||[]); }
    catch { videos = []; }
  }
  res.render('watch', { videos, csrfToken: req.csrfToken() });
});

// --- Admin guard ---
function requireAdmin(req,res,next){
  if (req.session.user && req.session.user.isAdmin) return next();
  return res.status(403).render('error', { message: 'Admins only.' });
}

// Admin UI to manage Watch videos
app.get('/admin/videos', csrfProtection, requireAdmin, (req,res)=>{
  const f = path.join(__dirname,'data','videos.json');
  let videos = [];
  if (fs.existsSync(f)){
    try { const raw = JSON.parse(fs.readFileSync(f,'utf8')); videos = Array.isArray(raw)? raw : (raw.videos||[]); }
    catch { videos = []; }
  }
  res.render('admin/videos', { videos, csrfToken: req.csrfToken(), messages: {} });
});

app.post('/admin/videos', csrfProtection, requireAdmin, (req,res)=>{
  const { title, url, channel, thumbnail } = req.body;
  if (!title || !url){
    return res.render('admin/videos', { videos: [], csrfToken: req.csrfToken(), messages: { error: 'Title and URL are required.' }});
  }
  const dir = path.join(__dirname,'data');
  const file = path.join(dir,'videos.json');
  let list = [];
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive:true });
  if (fs.existsSync(file)){
    try { const raw = JSON.parse(fs.readFileSync(file,'utf8')); list = Array.isArray(raw)? raw : (raw.videos||[]); } catch {}
  }
  list.push({ title, url, channel: channel||'', thumbnail: thumbnail||'' });
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  res.render('admin/videos', { videos: list, csrfToken: req.csrfToken(), messages: { success: 'Video added.' }});
});

app.post('/admin/videos/delete', csrfProtection, requireAdmin, (req,res)=>{
  const idx = Number(req.body.index);
  const file = path.join(__dirname,'data','videos.json');
  let list = [];
  if (fs.existsSync(file)){
    try { const raw = JSON.parse(fs.readFileSync(file,'utf8')); list = Array.isArray(raw)? raw : (raw.videos||[]); } catch {}
  }
  if (!isNaN(idx) && idx>=0 && idx<list.length){
    list.splice(idx,1);
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  }
  res.render('admin/videos', { videos: list, csrfToken: req.csrfToken(), messages: { success: 'Video deleted.' }});
});

// About / Contact simple routes (unchanged)
app.get('/about', csrfProtection, (req,res)=> res.render('about', { csrfToken: req.csrfToken() }));
app.get('/contact', csrfProtection, (req,res)=> res.render('contact', { csrfToken: req.csrfToken() }));

// Login/Register (stubs if no auth wired)
app.get('/login', csrfProtection, (req,res)=> res.render('login', { csrfToken: req.csrfToken(), messages: {} }));
app.get('/register', csrfProtection, (req,res)=> res.render('register', { csrfToken: req.csrfToken(), messages: {} }));

// 404 / errors
app.use((req,res)=> res.status(404).render('404', { buildId }));
app.use((err,req,res,next)=> { console.error('🔥 Error:', err); res.status(500).render('error', { message: err.message||'Internal error' }); });

app.listen(PORT, ()=> console.log(`🚀 Server running on port ${PORT}`));
