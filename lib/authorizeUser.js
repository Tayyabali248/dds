// Checks in with the central MongoDB before fillDDS.js is allowed to run:
// the local PTCL_USERNAME must be a registered, enabled user, and - if the
// admin has the fee-check gate turned on - their fee must be cleared for
// the current month. This check is authoritative from the DB; nothing in
// the local .env can bypass it.
//
// Does NOT manage the DB connection itself - the caller must already have
// one open (via connectDB()). This runs both from short-lived CLI scripts
// and from inside the long-running Express server; disconnecting here would
// tear down the server's shared connection out from under every other request.
const User = require('../models/User');
const { isFeeCheckEnabled, isFeeClearedForCurrentMonth, currentYearMonth } = require('./feeCheck');

// Returns nothing on success, throws with a human-readable message on denial.
async function authorizeUser(username) {
  const user = await User.findOne({ username });
  if (!user) {
    throw new Error(`Username "${username}" is not registered. Contact the admin to be added.`);
  }
  if (!user.enabled) {
    throw new Error(`Username "${username}" has been disabled. Contact the admin.`);
  }

  if (await isFeeCheckEnabled()) {
    const cleared = await isFeeClearedForCurrentMonth(user._id);
    if (!cleared) {
      const { year, month } = currentYearMonth();
      throw new Error(
        `Fee for ${month}/${year} has not been cleared for "${username}" yet. Contact the admin.`
      );
    }
  }
}

module.exports = authorizeUser;
