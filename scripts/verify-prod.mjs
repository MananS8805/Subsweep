// End-to-end smoke test of the PRODUCTION build: headers/CSP, keyboard and dialog behaviour, layout overflow at
// phone widths, and offline cold-start with persisted data. Needs a Chrome/Edge install (see scripts/browser.mjs).
//   npm run build && npm run preview:prod   (in one terminal)
//   node scripts/verify-prod.mjs [url]      (in another)
import { launch } from './browser.mjs';

const URL = process.argv[2] ?? 'http://localhost:4173';
let failed = 0;
const check = (name, pass, info = '') => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await context.newPage();
page.on('dialog', d => d.accept());
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

// ---- headers
const res = await page.goto(URL, { waitUntil: 'networkidle' });
const h = res.headers();
check('CSP header present and has no external sources', /default-src 'self'/.test(h['content-security-policy'] ?? '') && !/https?:\/\//.test(h['content-security-policy']));
check('nosniff + no-referrer', h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'no-referrer');
check('index.html is not cached', /no-cache/.test(h['cache-control'] ?? ''));
const sw = await page.request.get(URL + '/sw.js');
check('sw.js is served no-store', /no-store|no-cache/.test(sw.headers()['cache-control'] ?? ''));
const asset = await page.evaluate(() => [...document.scripts].map(s => s.src).find(Boolean));
const assetRes = await page.request.get(asset);
check('hashed assets are immutable', /immutable/.test(assetRes.headers()['cache-control'] ?? ''));

// ---- structure
check('one h1', (await page.locator('h1').count()) === 1);
check('main landmark + skip link', (await page.locator('main#main').count()) === 1 && (await page.locator('a.skip').count()) === 1);
await page.keyboard.press('Tab');
check('first Tab stop is the skip link', (await page.evaluate(() => document.activeElement?.textContent)) === 'Skip to content');
const manifest = await (await page.request.get(URL + '/manifest.webmanifest')).json();
check('manifest has name, start_url, scope, standalone and 192/512/maskable icons',
  manifest.name && manifest.short_name && manifest.start_url && manifest.scope && manifest.display === 'standalone'
  && manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'any') && manifest.icons.some(i => i.purpose === 'maskable'));

// ---- sample data (clearly labelled, confirmed)
await page.getByRole('button', { name: 'Load sample data' }).click();
await page.waitForSelector('text=fake sample data');
check('sample data loads behind a confirm and shows a banner', true);

// ---- keyboard: tabs
await page.getByRole('tab', { name: 'Explore' }).focus();
await page.keyboard.press('ArrowRight');
check('ArrowRight moves to the next tab', (await page.getByRole('tab', { name: 'Yearly' }).getAttribute('aria-selected')) === 'true');
await page.keyboard.press('End');
check('End goes to the last tab', (await page.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')) === 'true');
await page.keyboard.press('Home');
check('Home goes to the first tab', (await page.getByRole('tab', { name: 'Explore' }).getAttribute('aria-selected')) === 'true');

// ---- keyboard: dialog focus trap + Escape + focus return
const add = page.locator('button.add-top');
await add.focus();
await page.keyboard.press('Enter');
await page.waitForSelector('[role=dialog]');
check('dialog moves focus inside', await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')));
let escaped = false;
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('Tab');
  if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) escaped = true;
}
check('Tab never leaves the dialog', !escaped);
await page.keyboard.press('Escape');
await page.waitForSelector('[role=dialog]', { state: 'detached' });
check('Escape closes the dialog and focus returns to the trigger', await page.evaluate(() => document.activeElement?.className.includes('add-top')));

// ---- no horizontal overflow, every view, phone to desktop
for (const [w, hgt] of [[320, 640], [390, 844], [768, 900], [1280, 900]]) {
  await page.setViewportSize({ width: w, height: hgt });
  for (const tab of ['Explore', 'Yearly', 'Next 30 days', 'List']) {
    await page.getByRole('tab', { name: tab }).click();
    await page.waitForTimeout(250);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal scroll at ${w}px (${tab})`, over <= 0, over > 0 ? `+${over}px` : '');
  }
}
await page.setViewportSize({ width: 390, height: 844 });
const small = await page.evaluate(() => [...document.querySelectorAll('button,[role=tab],select,input:not([type=checkbox]):not([hidden])')]
  .filter(e => e.getClientRects().length && !e.closest('.sr-only'))
  .map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
  .filter(x => x.h < 44 || x.w < 44));
check('tap targets are at least 44x44 on a phone', small.length === 0, small.slice(0, 5).map(x => `${x.t} ${x.w}x${x.h}`).join('; '));
await page.setViewportSize({ width: 1280, height: 900 });

// ---- service worker + offline cold start
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'networkidle' }); // now controlled by the worker
check('page is controlled by the service worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
const names = await page.evaluate(() => caches.keys());
check('exactly one versioned cache', names.length === 1 && /^subsweep-\d+\.\d+\.\d+-[0-9a-f]{8}$/.test(names[0]), names.join(','));

await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1');
check('app loads offline from a cold start', (await page.locator('h1').textContent()) === 'SUBSWEEP');
check('offline chip is shown', await page.locator('.status-chip').isVisible());
await page.locator('button.add-top').click();
await page.getByLabel('Name').fill('Offline Test Sub');
await page.getByLabel('Amount').fill('123');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForSelector('[role=dialog]', { state: 'detached' });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('tab', { name: 'List' }).click();
check('data added offline survives an offline reload', (await page.locator('article h3', { hasText: 'Offline Test Sub' }).count()) === 1);
await context.setOffline(false);

check('no CSP violations', (await page.evaluate(() => window.__csp)).length === 0, (await page.evaluate(() => window.__csp)).join(' | '));
check('no console errors', errors.length === 0, errors.join(' | ').slice(0, 300));
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
