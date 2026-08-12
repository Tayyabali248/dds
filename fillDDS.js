// Automates the PTCL POMS "DDS New Customer" form.
//
// Always asks how many entries you want this session. One browser, one
// login, reused for every entry (no repeated logins).
//
// AUTO_SUBMIT=false (default, in .env): fills an entry and stops so you can
//   review it in the browser. Once you click Submit yourself, the script
//   detects that and automatically fills the next entry, and so on, until
//   the count is reached.
// AUTO_SUBMIT=true: fills and submits each entry itself, back-to-back, with
//   no pause for review.
//
// Run: node fillDDS.js
require('dotenv').config();
const puppeteer = require('puppeteer');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const {
  randomName,
  randomAddress,
  randomContactNumber,
  randomLatLngForAddress,
  randomEmail,
} = require('./lib/data');

const LOGIN_URL = 'https://my.ptcl.net.pk/POMS/Login.aspx';
const DDS_URL = 'https://my.ptcl.net.pk/POMS/DDSNewCustomer.aspx';

const USERNAME = process.env.PTCL_USERNAME;
const PASSWORD = process.env.PTCL_PASSWORD;
const AUTO_SUBMIT = String(process.env.AUTO_SUBMIT || 'false').toLowerCase() === 'true';

// Static values per the requested flow
const EXCHANGE = 'Rahim Yar Khan';
const REGION_VALUE = 'MTR';
const COMPETITION = 'Local';

if (!USERNAME || !PASSWORD) {
  console.error('Missing PTCL_USERNAME or PTCL_PASSWORD in .env file.');
  process.exit(1);
}

function buildEntry() {
  const name = randomName();
  const address = randomAddress();
  const { lat, lng } = randomLatLngForAddress(address);
  return {
    name,
    address: address.name,
    contact: randomContactNumber(),
    email: randomEmail(name),
    lat,
    lng,
  };
}

async function safeType(page, selector, value) {
  await page.click(selector, { clickCount: 3 });
  await page.keyboard.press('Backspace');
  if (value) await page.type(selector, value, { delay: 10 });
}

// TxtLatitude/TxtLongitude are readonly (normally auto-filled by the page's
// own browser-geolocation JS), so keyboard typing has no effect on them.
// Set the value directly via JS instead, which readonly does not block.
async function setValueViaJS(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

async function fieldValue(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.value : null;
  }, selector);
}

// Radio buttons here trigger __doPostBack (a real page postback). Clicking
// one can reload the page, so we wait for that to settle before continuing.
async function clickRadioAndSettle(page, id) {
  const navPromise = page
    .waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 })
    .catch(() => null);
  await page.click('#' + id);
  await navPromise;
  await new Promise((r) => setTimeout(r, 700));
}

async function fillForm(page, entry) {
  console.log('\nFilling entry:', entry);

  // Fill all text fields / dropdown FIRST, then trigger the radio postbacks
  // last, so every already-entered value is part of what gets posted back.
  await page.select('#ddlregionname', REGION_VALUE);
  await safeType(page, '#TextExchange', EXCHANGE);
  await safeType(page, '#TextName', entry.name);
  await safeType(page, '#TextAddress', entry.address);
  await safeType(page, '#TextContactNo', entry.contact);
  await safeType(page, '#TestCompName', COMPETITION);
  await setValueViaJS(page, '#TxtLatitude', String(entry.lat));
  await setValueViaJS(page, '#TxtLongitude', String(entry.lng));
  await safeType(page, '#TxtEmail', entry.email);

  await clickRadioAndSettle(page, 'rbOrderBookedNo'); // Order Status: Contact Later
  await clickRadioAndSettle(page, 'rbODNNo'); // Technology: FF

  // Postbacks can wipe unposted state in edge cases; verify and refill.
  const checks = [
    ['#TextExchange', EXCHANGE],
    ['#TextName', entry.name],
    ['#TextAddress', entry.address],
    ['#TextContactNo', entry.contact],
    ['#TestCompName', COMPETITION],
    ['#TxtLatitude', String(entry.lat)],
    ['#TxtLongitude', String(entry.lng)],
    ['#TxtEmail', entry.email],
  ];
  for (const [selector, expected] of checks) {
    const current = await fieldValue(page, selector);
    if (current !== expected) {
      console.log(`  Field ${selector} lost its value after postback, refilling...`);
      if (selector === '#TxtLatitude' || selector === '#TxtLongitude') {
        await setValueViaJS(page, selector, expected);
      } else {
        await safeType(page, selector, expected);
      }
    }
  }
  const region = await page.$eval('#ddlregionname', (el) => el.value).catch(() => null);
  if (region !== REGION_VALUE) {
    console.log('  Region dropdown lost its value after postback, resetting...');
    await page.select('#ddlregionname', REGION_VALUE);
  }
}

async function login(page) {
  console.log('Logging in...');
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('#txtUsername', USERNAME, { delay: 20 });
  await page.type('#txtPassword', PASSWORD, { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
    page.click('#btnLogin'),
  ]);
  console.log('Logged in.');
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
  });
  const page = await browser.newPage();

  await login(page);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const countStr = await rl.question('How many DDS entries this session? ');
  rl.close();
  const count = Math.max(1, parseInt(countStr, 10) || 1);

  if (!AUTO_SUBMIT) {
    console.log('\nAUTO_SUBMIT is false: after each entry is filled, review it in the browser and click');
    console.log('Submit yourself. As soon as you submit, the next entry fills automatically.');
  }

  for (let i = 1; i <= count; i++) {
    console.log(`\n=== Entry ${i}/${count} ===`);
    await page.goto(DDS_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    const entry = buildEntry();
    await fillForm(page, entry);

    if (AUTO_SUBMIT) {
      console.log('Submitting...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null),
        page.click('#btnLogin'),
      ]);
      await new Promise((r) => setTimeout(r, 800));
      console.log(`Entry ${i} submitted.`);
    } else {
      console.log('Filled. Review it in the browser and click Submit yourself when ready...');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 0 });
      console.log(`Entry ${i} submitted by you.`);
    }
  }

  console.log(`\nAll ${count} entries done.`);
  if (AUTO_SUBMIT) {
    await browser.close();
  } else {
    await browser.disconnect(); // leave the Chrome window open
  }
})().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
