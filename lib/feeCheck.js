const FeeStatus = require('../models/FeeStatus');
const { getSetting } = require('../models/Setting');

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 }; // month: 1-12
}

async function isFeeCheckEnabled() {
  return !!(await getSetting('feeCheckEnabled', false));
}

async function isFeeClearedForCurrentMonth(userId) {
  const { year, month } = currentYearMonth();
  const status = await FeeStatus.findOne({ user: userId, year, month });
  return !!(status && status.cleared);
}

module.exports = { currentYearMonth, isFeeCheckEnabled, isFeeClearedForCurrentMonth };
