// JSON API for the browser extension (replaces the old Puppeteer-driven
// public run route). No browser automation happens here anymore - this
// just authorizes a username (registered + enabled + fee-cleared-if-gate-is-on)
// and hands back randomly generated DDS entries for the extension's content
// script to fill into the real PTCL page in the user's own browser.
const express = require('express');
const authorizeUser = require('../lib/authorizeUser');
const { buildEntries } = require('../lib/data');

const router = express.Router();

// Permissive CORS: MV3 extensions with host_permissions for this origin
// already bypass CORS from their background script, but this is a harmless
// safety net (no PTCL credentials ever pass through this endpoint).
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

router.post('/dds/entries', async (req, res) => {
  const { ptclUsername, count } = req.body;

  if (!ptclUsername || !String(ptclUsername).trim()) {
    return res.status(400).json({ error: 'ptclUsername is required.' });
  }

  const username = String(ptclUsername).trim();

  try {
    await authorizeUser(username);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  const safeCount = Math.max(1, Math.min(200, parseInt(count, 10) || 1));
  const entries = buildEntries(safeCount);
  res.json({ entries });
});

module.exports = router;
