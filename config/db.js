const mongoose = require('mongoose');

// Safe to call multiple times (e.g. once from server.js at startup, and
// again from a script that also imports a module which calls this) - it's a
// no-op if a connection is already open, so nothing accidentally tears down
// a connection another part of the process is relying on.
async function connectDB() {
  if (mongoose.connection.readyState === 1) return; // already connected

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
}

module.exports = connectDB;
