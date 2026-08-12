# DDS Entry Assistant (browser extension)

Replaces the old Puppeteer-driven automation with a WebExtension that fills the real
PTCL POMS "DDS New Customer" form in your own, already-logged-in browser tab. The
extension never sees your PTCL password - you log into PTCL yourself as normal; the
extension only fills/submits the DDS form. Entry data and authorization (registered +
enabled + fee-cleared) still come from the same `dds` backend (Express + MongoDB) used
by the admin panel.

## Setup

```bash
cd data-entry-extension
npm install
npm run build
```

This produces `extension/dist/chrome/` and `extension/dist/firefox/` - load either as an
unpacked/temporary extension. Both are built from the same TypeScript source; only
`manifest.json` differs per browser.

The backend must be running (`node server.js` from the `dds/` project root) and your
PTCL username must already be added and enabled in the admin Users page.

## Load into Chrome

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" -> select `data-entry-extension/extension/dist/chrome`

## Load into Firefox

1. `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on" -> select `data-entry-extension/extension/dist/firefox/manifest.json`

(Temporary add-ons are removed when Firefox restarts - fine for testing. Permanent
installation requires signing, out of scope for this MVP.)

## Using it

1. Log into `https://my.ptcl.net.pk/POMS/` yourself, normally, in the browser you loaded
   the extension into.
2. Navigate to the DDS New Customer page.
3. Click the extension icon.
4. Enter your PTCL username (the one registered in the admin roster), how many entries,
   and pick Auto Submit or Manual Submit.
5. Click Start.

**Auto Submit**: fills a record, verifies it, clicks Submit itself, waits for the page to
reset (confirming it went through), then moves to the next entry - repeats until done.

**Manual Submit**: fills a record and stops. You review it and click the real Submit
button on the page yourself. The extension detects the page resetting afterward and
automatically fills the next entry. It never clicks Submit for you in this mode.

Pause/Resume/Stop and Retry/Skip (shown on failure) work as you'd expect. Progress
persists in `chrome.storage.local` / `browser.storage.local`, so closing the popup,
restarting the browser, or the background service worker being killed and restarted by
the browser (normal MV3 behavior) doesn't lose your place.

## Why the flow works despite full-page reloads

The real DDS form isn't a simple single-page form: selecting the two required radio
buttons (Order Status, Technology) each triggers a genuine ASP.NET postback that reloads
the whole page - so does the final Submit. A content script's execution is destroyed the
instant that reload starts; it cannot "wait" across it the way Puppeteer could.

Instead, every fresh page load re-derives what to do next purely from the DOM: it
compares the current field values / which radios are checked against the record it's
supposed to be filling. If everything already matches and both radios are checked, it's
ready to submit. If the fields *used to* match but no longer do while we were
submitting/waiting, that means the previous submission actually went through, and it
moves on to the next record. Nothing depends on timers - only on what's actually on the
page.

## Known Chrome/Firefox differences

- **Background execution model**: Chrome runs `background.service_worker` (a true,
  ephemeral service worker). Firefox's MV3 implementation currently uses
  `background.scripts` (a non-persistent background page) instead of a real service
  worker. Both manifests are already set up for this; the same bundled `background.js`
  runs fine in either mode since it only uses `chrome.*`/`browser.*` APIs and never
  assumes DOM/`window` is (or isn't) available.
- **API style**: Firefox's native `browser.*` namespace returns Promises directly; Chrome's
  `chrome.*` is callback-based. Everything goes through `platform/browser.ts`, the one
  file that knows the difference - nothing else in the codebase touches `chrome.*` or
  `browser.*` directly.
- **Cross-origin fetch to the backend**: the background script's `fetch()` calls to
  `http://localhost:3000` work without CORS headers on the server because
  `host_permissions` grants the extension's privileged background context cross-origin
  access in both browsers. If you ever move the backend off `localhost:3000`, update
  `BACKEND_URL` in `extension/src/config/backend.ts` **and** `host_permissions` in both
  manifests, then rebuild.
- **Firefox Android**: `browser_specific_settings.gecko_android` is set, and nothing in
  this codebase uses a desktop-only API, but I have not been able to test on an actual
  Android device from here - treat it as untested/best-effort and verify manually.
- **Firefox extension ID / signing**: `dds-entry-assistant@local.test` is a placeholder
  good enough for temporary loading. Permanent installation on release Firefox requires
  submitting for signing (or using a self-hosted/unbranded build), which is out of scope
  for this MVP.

## What I could verify from here vs. what you'll need to test yourself

I don't have a way to drive a real GUI browser from this environment (Puppeteer/
Playwright/Selenium are exactly what this project replaced), so I verified everything
that's verifiable without one:

- `tsc --noEmit` passes with no errors.
- The build produces valid `dist/chrome` and `dist/firefox` folders with correct,
  distinct manifests and identical bundled JS/HTML/CSS.
- The backend's new `POST /api/dds/entries` endpoint was tested directly (curl): a
  registered username gets back correctly-shaped entry data, an unregistered one gets a
  clear 403 with no data.

What I could **not** verify (needs you, in a real browser, against the real site):

- Loading the unpacked extension in Chrome/Firefox and confirming the popup renders.
- That the field selectors (`#ddlregionname`, `#TextName`, `#hfLatitude`, etc.) still
  match the live PTCL page - they're taken directly from the working Puppeteer version,
  but PTCL could change their markup at any time.
- The actual Auto/Manual submit flow end-to-end, including the postback-survival logic
  above, against a real logged-in session.

Please run through Auto mode with a small count (e.g. 2-3) first, then Manual mode, then
try Pause/Resume/Stop/Retry/Skip, and let me know what breaks - I'll fix it directly
rather than guessing.
