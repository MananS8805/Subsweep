// Checks the service worker update flow against a copy of dist/ whose worker version is bumped mid-test.
//   npm run build && node scripts/verify-update.mjs
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { launch } from './browser.mjs';

const dist = new URL('../dist', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const site = mkdtempSync(join(tmpdir(), 'subsweep-update-'));
cpSync(dist, site, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  let f = normalize(join(site, p === '/' ? 'index.html' : p));
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(site, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(4174, r));
const URL_ = 'http://localhost:4174';

let failed = 0;
const check = (name, pass, info = '') => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const swVersion = async (page) => page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return await new Promise((resolve) => {
    const worker = reg.active;
    const onMsg = (e) => { if (e.data?.type === 'VERSION') { navigator.serviceWorker.removeEventListener('message', onMsg); resolve(e.data.version); } };
    navigator.serviceWorker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'GET_VERSION' });
  });
});

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('dialog', d => d.accept());

await page.goto(URL_, { waitUntil: 'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'networkidle' });
const v1 = await swVersion(page);
check('first version is active', /^\d+\.\d+\.\d+-[0-9a-f]{8}$/.test(v1), v1);
check('no update banner yet', (await page.locator('.banner.update').count()) === 0);

// put some data in, so we can prove an update never touches it
await page.getByRole('button', { name: 'Load sample data' }).click();
await page.waitForSelector('text=fake sample data');
const before = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const q = r.result.transaction('subs').objectStore('subs').count(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
const origin = await page.evaluate(() => performance.timeOrigin);

// "ship" a new version: bump the worker's version so the browser sees a changed sw.js
const swPath = join(site, 'sw.js');
writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const VERSION = "([^"]+)";/, (_, v) => `const VERSION = "${v}-next";`));
await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
await page.waitForSelector('.banner.update', { timeout: 10000 });
check('update banner appears when a new worker is waiting', true);
check('banner offers a Reload button', await page.getByRole('button', { name: 'Reload to update' }).isVisible());
await page.waitForTimeout(1500);
check('page did not reload by itself', (await page.evaluate(() => performance.timeOrigin)) === origin);
check('old version is still the active one until the user reloads', (await swVersion(page)) === v1);

// an open form must not be lost: while a dialog is open the banner is covered, so Reload cannot be hit by accident
await page.locator('button.add-top').click();
await page.getByLabel('Name').fill('Half typed');
const covered = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.banner.update button')][0].getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return !hit?.closest('.banner.update');
});
check('with a form open, the Reload button is covered by the dialog overlay', covered);
await page.waitForTimeout(1500);
check('the open form and its text are untouched', (await page.evaluate(() => performance.timeOrigin)) === origin && (await page.getByLabel('Name').inputValue()) === 'Half typed');
await page.keyboard.press('Escape');
await page.waitForSelector('[role=dialog]', { state: 'detached' });

// now accept
await page.getByRole('button', { name: 'Reload to update' }).click();
await page.waitForFunction((o) => performance.timeOrigin !== o, origin, { timeout: 10000 });
await page.waitForSelector('h1');
await page.evaluate(() => navigator.serviceWorker.ready);
const v2 = await swVersion(page);
check('after Reload the new version is active', v2 === v1 + '-next', v2);
check('the update banner is gone', (await page.locator('.banner.update').count()) === 0);
const caches_ = await page.evaluate(() => caches.keys());
check('old cache was deleted, only the new one remains', caches_.length === 1 && caches_[0] === 'subsweep-' + v2, caches_.join(','));
const after = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const q = r.result.transaction('subs').objectStore('subs').count(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
check('IndexedDB data is untouched by the update', after === before && after > 0, `${before} -> ${after}`);

await browser.close();
server.close();
rmSync(site, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
