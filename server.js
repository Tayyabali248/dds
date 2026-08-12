require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

// Building the app is async (must connect to Mongo first), but Vercel's
// Node runtime needs a request handler available immediately on import -
// so build it once and cache the in-flight/completed promise, rather than
// wrapping everything in a top-level async IIFE that calls app.listen().
let appPromise = null;

async function buildApp() {
  await connectDB();

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', __dirname + '/views');
  app.set('trust proxy', 1); // Vercel sits behind a reverse proxy

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(__dirname + '/public'));

  app.use(
    session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
      cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 hours
    })
  );

  // Makes `session` available in every EJS view without passing it explicitly.
  app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
  });

  app.get('/', (req, res) => res.redirect(req.session.adminId ? '/admin/fees' : '/login'));
  app.use('/', authRoutes);
  app.use('/api', apiRoutes);
  app.use('/admin', adminRoutes);

  return app;
}

function getApp() {
  if (!appPromise) appPromise = buildApp();
  return appPromise;
}

// Vercel serverless entry point: Vercel calls this exported function per
// request, awaiting it first so the (cached, after the first call) Express
// app is ready before handling anything.
module.exports = async (req, res) => {
  const app = await getApp();
  app(req, res);
};

// Local/plain-Node dev: only bind a real listener when this file is run
// directly (`node server.js`), not when Vercel imports it as a module.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  getApp()
    .then((app) => {
      app.listen(PORT, () => console.log(`DDS web app running at http://localhost:${PORT}`));
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
