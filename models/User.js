// A registered DDS-automation user (the roster the admin manages). This is
// NOT a login account - no password is stored here. The username must match
// the PTCL_USERNAME each person runs fillDDS.js with locally; the script
// checks in against this record before it's allowed to run.
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);
