import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0,300)); });

// Sign in via the dev magic link.
const link = process.env.MAGIC_LINK;
if (!link) { console.log('set MAGIC_LINK'); process.exit(1); }
await page.goto(link, { waitUntil: 'domcontentloaded' });
console.log('after verify:', page.url());

const shots = process.argv.slice(2);
for (const path of shots.length ? shots : ['/today']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  const name = path.replace(/[^a-z0-9]+/gi, '_') || 'root';
  await page.screenshot({ path: `/tmp/claude-0/-home-user-Theme/637f6a30-1bd3-5cce-98c9-d68c1f8581ed/scratchpad/desk${name}.png`, fullPage: true });
  console.log('shot', path);
}

// Phone view
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
const p2 = await phone.newPage();
for (const path of shots.length ? shots : ['/today']) {
  await p2.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(300);
  const name = path.replace(/[^a-z0-9]+/gi, '_') || 'root';
  await p2.screenshot({ path: `/tmp/claude-0/-home-user-Theme/637f6a30-1bd3-5cce-98c9-d68c1f8581ed/scratchpad/mob${name}.png`, fullPage: true });
}
await browser.close();
