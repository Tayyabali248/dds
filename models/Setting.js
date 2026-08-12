// Simple key/value settings store. Currently used for the global
// fee-check-enabled switch, controlled only from the admin panel - this
// must live in the DB (not a local .env) so no distributed script can
// bypass it by editing its own local config.
const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
});

const Setting = mongoose.model('Setting', settingSchema);

async function getSetting(key, defaultValue) {
  const doc = await Setting.findOne({ key });
  return doc ? doc.value : defaultValue;
}

async function setSetting(key, value) {
  await Setting.findOneAndUpdate({ key }, { key, value }, { upsert: true });
}

module.exports = { Setting, getSetting, setSetting };
