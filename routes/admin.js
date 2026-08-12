const express = require('express');
const User = require('../models/User');
const FeeStatus = require('../models/FeeStatus');
const { requireAdmin } = require('../lib/authMiddleware');
const { currentYearMonth, isFeeCheckEnabled } = require('../lib/feeCheck');
const { setSetting } = require('../models/Setting');

const router = express.Router();
router.use(requireAdmin);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

router.get('/', (req, res) => res.redirect('/admin/fees'));

// --- Roster (registered DDS-automation usernames) ---
router.get('/users', async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.render('admin-users', { users, error: null, success: null });
});

router.post('/users', async (req, res) => {
  const { username } = req.body;
  const users = await User.find().sort({ createdAt: -1 });

  if (!username || !username.trim()) {
    return res.render('admin-users', { users, error: 'Username is required.', success: null });
  }

  const existing = await User.findOne({ username: username.trim() });
  if (existing) {
    return res.render('admin-users', { users, error: 'That username already exists.', success: null });
  }

  await User.create({ username: username.trim() });

  const updatedUsers = await User.find().sort({ createdAt: -1 });
  res.render('admin-users', { users: updatedUsers, error: null, success: `User "${username}" added.` });
});

router.post('/users/:id/update', async (req, res) => {
  const { username } = req.body;
  const users = await User.find().sort({ createdAt: -1 });

  if (!username || !username.trim()) {
    return res.render('admin-users', { users, error: 'Username is required.', success: null });
  }
  const conflict = await User.findOne({ username: username.trim(), _id: { $ne: req.params.id } });
  if (conflict) {
    return res.render('admin-users', { users, error: 'That username already exists.', success: null });
  }

  await User.findByIdAndUpdate(req.params.id, { username: username.trim() });
  const updatedUsers = await User.find().sort({ createdAt: -1 });
  res.render('admin-users', { users: updatedUsers, error: null, success: 'User updated.' });
});

router.post('/users/:id/toggle', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (user) {
    user.enabled = !user.enabled;
    await user.save();
  }
  res.redirect('/admin/users');
});

// --- Monthly fee dashboard ---
router.get('/fees', async (req, res) => {
  const now = currentYearMonth();
  const year = parseInt(req.query.year, 10) || now.year;
  const month = parseInt(req.query.month, 10) || now.month;

  const users = await User.find().sort({ username: 1 });
  const statuses = await FeeStatus.find({ year, month });
  const statusByUser = new Map(statuses.map((s) => [s.user.toString(), s]));

  const rows = users.map((u) => ({
    user: u,
    cleared: statusByUser.get(u._id.toString())?.cleared || false,
  }));

  const feeCheckEnabled = await isFeeCheckEnabled();

  res.render('admin-fees', { rows, year, month, MONTH_NAMES, feeCheckEnabled });
});

router.post('/fees/toggle', async (req, res) => {
  const { userId, year, month } = req.body;
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);

  const existing = await FeeStatus.findOne({ user: userId, year: y, month: m });
  if (existing) {
    existing.cleared = !existing.cleared;
    existing.clearedAt = existing.cleared ? new Date() : null;
    existing.clearedBy = existing.cleared ? req.session.adminId : null;
    await existing.save();
  } else {
    await FeeStatus.create({
      user: userId,
      year: y,
      month: m,
      cleared: true,
      clearedAt: new Date(),
      clearedBy: req.session.adminId,
    });
  }

  res.redirect(`/admin/fees?year=${y}&month=${m}`);
});

router.post('/fees/toggle-check', async (req, res) => {
  const enabled = await isFeeCheckEnabled();
  await setSetting('feeCheckEnabled', !enabled);
  res.redirect(`/admin/fees?year=${req.body.year}&month=${req.body.month}`);
});

module.exports = router;
