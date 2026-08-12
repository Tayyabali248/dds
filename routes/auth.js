const express = require('express');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin/fees');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = await Admin.findOne({ username: (username || '').trim() });

  if (!admin || !(await bcrypt.compare(password || '', admin.passwordHash))) {
    return res.render('login', { error: 'Invalid username or password.' });
  }

  req.session.adminId = admin._id.toString();
  req.session.adminUsername = admin.username;
  res.redirect('/admin/fees');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
