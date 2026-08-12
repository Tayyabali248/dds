// Creates the first admin account. Run once: node seed/createAdmin.js
// Generates a random secure password and prints it ONCE - save it somewhere
// safe, it is not stored in plain text anywhere and cannot be recovered
// (only reset by running this script again with a different username, or via
// a future "reset password" feature).
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Admin = require('../models/Admin');

function generatePassword(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from(crypto.randomFillSync(new Uint8Array(length)))
    .map((b) => chars[b % chars.length])
    .join('');
}

(async () => {
  await connectDB();

  const existingAdmin = await Admin.findOne();
  if (existingAdmin) {
    console.log(`An admin account already exists: "${existingAdmin.username}". No new admin created.`);
    await mongoose.disconnect();
    return;
  }

  const username = 'admin';
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  await Admin.create({ username, passwordHash });

  console.log('Admin account created.');
  console.log('  Username:', username);
  console.log('  Password:', password);
  console.log('Save this password now - it will not be shown again.');

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
