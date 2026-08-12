require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

const PORT = process.env.PORT || 3000;

(async () => {
  await connectDB();

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', __dirname + '/views');

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

  app.listen(PORT, () => console.log(`DDS web app running at http://localhost:${PORT}`));
})().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
