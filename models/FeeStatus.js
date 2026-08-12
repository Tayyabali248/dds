const mongoose = require('mongoose');

const feeStatusSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true, min: 1, max: 12 }, // 1 = January
  cleared: { type: Boolean, default: false },
  clearedAt: { type: Date, default: null },
  clearedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
});

feeStatusSchema.index({ user: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('FeeStatus', feeStatusSchema);
