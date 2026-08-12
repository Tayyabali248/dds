// Logs into PTCL POMS and reports what the post-login (landing) page looks like.
// Run: node login.js
require('dotenv').config();
const puppeteer = require('puppeteer');

const LOGIN_URL = 'https://my.ptcl.net.pk/POMS/Login.aspx';

const USERNAME = process.env.PTCL_USERNAME;
const PASSWORD = process.env.PTCL_PASSWORD;

if (!USERNAME || !PASSWORD) {
  console.error('Missing PTCL_USERNAME or PTCL_PASSWORD in .env file.');
  process.exit(1);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized'],
  });
  const page = await browser.newPage();

  console.log(`Navigating to ${LOGIN_URL} ...`);
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.type('#txtUsername', USERNAME, { delay: 20 });
  await page.type('#txtPassword', PASSWORD, { delay: 20 });

  console.log('Submitting login form...');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
    page.click('#btnLogin'),
  ]);

  console.log('Current URL after login:', page.url());

  // Check for a visible login error message, if any
  const errorText = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('span, div'))
      .filter(el => /invalid|incorrect|error/i.test(el.innerText || '') && el.offsetParent !== null);
    return candidates.map(el => el.innerText.trim()).join(' | ') || null;
  });
  if (errorText) {
    console.log('Possible login error message found:', errorText);
  }

  await page.screenshot({ path: 'after-login.png', fullPage: true });
  console.log('Screenshot saved to after-login.png');

  // List top-level nav links/menu items so we can spot the DDS entry section
  const navItems = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links
      .map(a => ({ text: a.innerText.trim(), href: a.getAttribute('href'), id: a.id || null }))
      .filter(x => x.text);
  });
  console.log('\n=== NAV / MENU LINKS ===');
  console.table(navItems);

  await browser.close();
  console.log('\nDone.');
})().catch(async (err) => {
  console.error('Error:', err);
  process.exit(1);
});
