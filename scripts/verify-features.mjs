// End-to-end check of the detection preview, undo and reminder features on the PRODUCTION build.
//   npm run build && npm run preview:prod     (one terminal)
//   node scripts/verify-features.mjs [url]    (another)
// Needs Chrome or Edge (scripts/browser.mjs). Uses a fake Notification so reminders can be counted.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const path = (rel) => new globalThis.URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const MIXED = path('../sample-data/mixed-cycles.csv');
const tmp = mkdtempSync(join(tmpdir(), 'subsweep-feat-'));

let failed = 0;
const check = (name, pass, info = '') => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const browser = await launch();

/** A fresh profile with a fake Notification that records every notification in sessionStorage. */
async function open({ perm = 'granted', width = 1280, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((p) => {
    const KEY = '__notes';
    window.Notification = class {
      constructor(title, opts) { const a = JSON.parse(sessionStorage.getItem(KEY) || '[]'); a.push({ title, body: opts && opts.body }); sessionStorage.setItem(KEY, JSON.stringify(a)); }
      static get permission() { return p; }
      static requestPermission() { return Promise.resolve(p); }
    };
  }, perm);
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { context, page };
}
const notes = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('__notes') || '[]'));
const subs = (page) => page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const q = r.result.transaction('subs').objectStore('subs').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
const tab = async (page, name) => { await page.getByRole('tab', { name }).click(); await page.waitForTimeout(500); };
const scan = async (page, file) => { await page.locator('input[type=file][accept*=csv]').setInputFiles(file); };
// a card by the name in its heading (matching the whole card text also hits other cards' hidden how-to-cancel steps)
const card = (page, name) => page.locator('article.sub').filter({ has: page.locator('h3', { hasText: new RegExp('^' + name) }) });
const flip = async (page, label) => { await page.getByLabel(label).click(); await page.waitForTimeout(350); };
const addManual = async (page, name, amount) => {
  await page.locator('button.add-top').click();
  await page.getByLabel('Name').fill(name); await page.getByLabel('Amount').fill(String(amount));
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
};
const statText = (page, label) => page.locator('.summary .stat', { hasText: label }).first().locator('strong').innerText();

// a weekly series with varying amounts (like groceries): must be Low and unticked
writeFileSync(join(tmp, 'weekly-varying.csv'), 'Date,Description,Amount\n' + [40, 55, 32, 61, 47, 38, 59, 44]
  .map((a, i) => `${new Date(Date.UTC(2026, 7, 1 + i * 7)).toISOString().slice(0, 10)},FRESH MARKET,-${a}`).join('\n') + '\n');

// ================= 1-3: preview, nothing saved until confirmed, edits, undo of exactly one import ================
{
  const { context, page } = await open();
  await tab(page, 'List');
  await scan(page, MIXED);
  await page.waitForSelector('[role=dialog]');
  const rows = await page.locator('.pv-row').evaluateAll(els => els.map(e => ({
    name: e.querySelector('.pv-title b').textContent, chip: e.querySelector('.conf').textContent,
    meta: e.querySelector('.pv-title small').textContent, checked: e.querySelector('input[type=checkbox]').checked,
  })));
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  check('preview lists all seven real subscriptions and no groceries or fuel', rows.length === 7 && !rows.some(r => /whole|shell/i.test(r.name)), rows.map(r => r.name).join(', '));
  check('cycles are labelled (weekly, every 2 weeks, monthly, quarterly, yearly)',
    /Weekly/.test(by.Pilates.meta) && /Every 2 weeks/.test(by.Freshbox.meta) && /Monthly/.test(by.Spotify.meta) && /Quarterly/.test(by.Greenleaf.meta) && /Yearly/.test(by.Namecheap.meta));
  check('confidence chips: High for regular series, Medium for a yearly charge seen twice',
    /High/.test(by.Spotify.chip) && /High/.test(by.Pilates.chip) && /Medium/.test(by.Namecheap.chip));
  check('High and Medium start ticked', rows.every(r => r.checked));
  check('sorted most confident first (the Medium one is last)', rows[rows.length - 1].name === 'Namecheap');
  check('the price rise shows up in the preview', /price up/.test(by.Netflix.meta));
  check('nothing is saved while the preview is open', (await subs(page)).length === 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  check('closing the preview saves nothing', (await subs(page)).length === 0);

  // low-confidence rows start unticked and cannot be added until ticked
  await scan(page, join(tmp, 'weekly-varying.csv'));
  await page.waitForSelector('[role=dialog]');
  const low = await page.locator('.pv-row').evaluateAll(els => els.map(e => ({ chip: e.querySelector('.conf').textContent, checked: e.querySelector('input[type=checkbox]').checked })));
  check('a grocery-style weekly series is Low and unticked', low.length === 1 && /Low/.test(low[0].chip) && !low[0].checked, JSON.stringify(low));
  check('with nothing ticked the Add button is disabled', await page.getByRole('button', { name: 'Add 0 selected' }).isDisabled());
  await page.getByLabel('Add Fresh').check();
  check('ticking it enables "Add 1 selected"', await page.getByRole('button', { name: 'Add 1 selected' }).isEnabled());
  await page.locator('[role=dialog]').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  // earlier data that undo must never touch
  await addManual(page, 'Mine', 10);
  const mineId = (await subs(page)).find(s => s.name === 'Mine').id;

  // keyboard in the preview: Space toggles, Tab never leaves, Escape closes
  await scan(page, MIXED);
  await page.waitForSelector('[role=dialog]');
  const first = page.locator('.pv-row input[type=checkbox]').first();
  await first.focus();
  const before = await first.isChecked();
  await page.keyboard.press('Space');
  check('Space toggles a row from the keyboard', (await first.isChecked()) !== before);
  await page.keyboard.press('Space');
  let escaped = false;
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]')))) escaped = true; }
  check('Tab stays inside the preview dialog', !escaped);

  // untick one, edit an amount and a name, add
  await page.getByLabel('Add Pilates').uncheck();
  const spotify = page.locator('.pv-row', { hasText: 'Spotify' });
  await spotify.getByLabel(/^Amount/).fill('12.5');
  await page.getByRole('button', { name: 'Add 6 selected' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  await page.waitForSelector('.toast');
  const added = await subs(page);
  check('adds exactly the ticked rows (6) next to the existing one', added.length === 7 && !added.some(s => s.name === 'Pilates'));
  const sp = added.find(s => s.name === 'Spotify');
  check('the edited amount was saved and recorded as the latest price', sp.amount === 12.5 && sp.priceHistory.at(-1).amount === 12.5);
  const nf = added.find(s => s.name === 'Netflix');
  check('price history, confidence and batch id are stored', nf.priceHistory.length === 2 && nf.confidence > 0.75 && /^import-/.test(nf.importBatchId));
  check('toast announces the import', /Added 6 subscriptions/.test(await page.locator('.toast').innerText()));
  check('live region carries the same message once', (await page.locator('[role=status].sr-only').innerText()).includes('Added 6 subscriptions'));

  // keyboard-only: Undo is the very next Tab stop after the skip link, and Ctrl+Z works too
  await page.locator('a.skip').focus();
  await page.keyboard.press('Tab');
  check('Undo is the first Tab stop after the skip link', (await page.evaluate(() => document.activeElement?.textContent)) === 'Undo');
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !document.querySelector('.toast'));
  const afterUndo = await subs(page);
  check('Ctrl+Z undoes exactly that import and nothing else', afterUndo.length === 1 && afterUndo[0].name === 'Mine' && afterUndo[0].id === mineId);

  // 4: delete with undo
  await tab(page, 'List');
  await card(page, 'Mine').getByRole('button', { name: 'Remove' }).click();
  await page.waitForSelector('.toast');
  check('removing shows an Undo toast (no confirm dialog first)', /Removed Mine/.test(await page.locator('.toast').innerText()) && (await subs(page)).length === 0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForSelector('article.sub');
  const restored = await subs(page);
  check('Undo brings the subscription back with the same id', restored.length === 1 && restored[0].id === mineId && restored[0].amount === 10);
  await context.close();
}

// ================= 6: reminders, windows, mute, snooze, no duplicates ================
{
  const { context, page } = await open();
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await page.waitForSelector('text=fake sample data');
  await page.waitForTimeout(1200);
  const n1 = await notes(page);
  check('default window (7 days): the three renewals within a week are notified once', n1.length === 3, n1.map(n => n.title).join(' | '));
  check('the trial gets a "Trial ends" notification', n1.some(n => /^Trial ends/.test(n.title)));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('reloading does not notify again', (await notes(page)).length === 3);

  await page.locator('#reminder-settings').scrollIntoViewIfNeeded();
  await flip(page, '7 days before');
  await flip(page, '1 day before');
  await flip(page, '3 days before');
  await page.waitForTimeout(1200);
  const n2 = await notes(page);
  check('switching to 1 and 3 days notifies only the new 3-day window for the renewal 2 days out', n2.length === 4, n2.map(n => n.title).slice(3).join(' | '));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('still no duplicates after another reload', (await notes(page)).length === 4);

  await tab(page, 'List');
  const monthlyBefore = await statText(page, 'Per month');
  const soonBefore = await page.locator('[aria-labelledby=renewing-soon-title] .chip b').allInnerTexts();
  check('"Renewing soon" lists the due items with the soonest labelled', soonBefore.length >= 2 && /next (today|tomorrow|in \d+ days)/i.test(await page.locator('#renewing-soon-title').innerText()), soonBefore.join(', '));
  await card(page, 'Spotify').locator('.bell-menu summary').click();
  await page.getByRole('button', { name: 'Snooze 1 day' }).click();
  await page.waitForTimeout(500);
  const soonAfter = await page.locator('[aria-labelledby=renewing-soon-title] .chip b').allInnerTexts();
  check('a snoozed item leaves the renewing-soon list', !soonAfter.includes('Spotify') && soonBefore.includes('Spotify'), soonAfter.join(', '));
  check('the snoozed card shows its status', /Snoozed until/.test(await card(page, 'Spotify').locator('.bell-label').innerText()));
  await card(page, 'Headspace').locator('.bell-menu summary').click();
  await page.getByRole('button', { name: 'Mute reminders' }).click();
  await page.waitForTimeout(500);
  check('a muted trial leaves the list too', !(await page.locator('[aria-labelledby=renewing-soon-title] .chip b').allInnerTexts()).includes('Headspace'));
  check('muting and snoozing do not change the totals', (await statText(page, 'Per month')) === monthlyBefore);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await tab(page, 'List');
  check('mute and snooze survive a reload', /Muted/.test(await card(page, 'Headspace').locator('.bell-label').innerText()) && /Snoozed/.test(await card(page, 'Spotify').locator('.bell-label').innerText()));
  check('no new notifications after muting or snoozing', (await notes(page)).length === 4);
  await card(page, 'Headspace').locator('.bell-menu summary').click();
  await page.getByRole('button', { name: 'Unmute reminders' }).click();
  await page.waitForTimeout(500);
  check('unmute puts reminders back', !/Muted/.test(await card(page, 'Headspace').locator('.bell-label').innerText()));
  await context.close();
}
{
  const { context, page } = await open({ perm: 'denied' });
  await page.getByRole('button', { name: 'Load sample data' }).click();
  await page.waitForSelector('text=fake sample data');
  check('denied permission: an in-app note explains it, and nothing is fired', (await page.locator('.banner', { hasText: 'notifications are blocked' }).count()) === 1 && (await notes(page)).length === 0);
  check('the in-app renewing-soon list still works', (await page.locator('[aria-labelledby=renewing-soon-title] .chip').count()) >= 1);
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.reload({ waitUntil: 'networkidle' });
  check('the note does not come back after being dismissed (no nagging)', (await page.locator('.banner', { hasText: 'notifications are blocked' }).count()) === 0);
  await context.close();
}

// ================= 7: v0.5 data upgrades without loss ================
{
  const { context, page } = await open();
  await page.evaluate(async () => {
    await new Promise(r => { const q = indexedDB.deleteDatabase('subsweep'); q.onsuccess = r; q.onblocked = r; setTimeout(r, 1500); });
    await new Promise((res, rej) => {
      const req = indexedDB.open('subsweep', 40); // Dexie v4 = IndexedDB version 40
      req.onupgradeneeded = () => {
        const d = req.result;
        const s = d.createObjectStore('subs', { keyPath: 'id', autoIncrement: true }); s.createIndex('name', 'name'); s.createIndex('nextRenewal', 'nextRenewal');
        const dd = d.createObjectStore('dismissedDuplicates', { keyPath: 'id', autoIncrement: true }); dd.createIndex('key', 'key', { unique: true });
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const tx = req.result.transaction(['subs', 'settings'], 'readwrite');
        tx.objectStore('subs').add({ name: 'Netflix', amount: 649, currency: 'INR', cycle: 'monthly', nextRenewal: '2027-01-03', category: 'Streaming', isTrial: false, createdAt: '2026-02-10T08:00:00.000Z', priceCreep: { from: 499, to: 649 } });
        tx.objectStore('subs').add({ name: 'Hulu', amount: 7.99, currency: 'USD', cycle: 'weekly', nextRenewal: '2027-01-05', category: 'Streaming', isTrial: false });
        tx.objectStore('settings').put({ key: 'baseCurrency', value: 'INR' });
        tx.oncomplete = () => { req.result.close(); res(); };
      };
      req.onerror = rej;
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const up = await subs(page);
  check('v0.5 rows all survive the upgrade', up.length === 2 && up.map(s => s.name).sort().join() === 'Hulu,Netflix');
  check('each gets a one-entry price history from its current price', up.every(s => s.priceHistory?.length === 1 && s.priceHistory[0].amount === s.amount));
  check('existing flags are untouched', up.find(s => s.name === 'Netflix').priceCreep.to === 649);
  const meta = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const o = { v: r.result.version, stores: [...r.result.objectStoreNames] }; r.result.close(); res(o); }; }));
  check('database is now v5 with the reminders table', meta.v === 50 && meta.stores.includes('notifiedReminders'), JSON.stringify(meta));
  await context.close();
}

// ================= 8 + 9: backup round trip, then everything offline ================
{
  const { context, page } = await open();
  await tab(page, 'List');
  await scan(page, MIXED);
  await page.waitForSelector('[role=dialog]');
  await page.getByRole('button', { name: /^Add \d+ selected$/ }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  await card(page, 'Netflix').locator('.bell-menu summary').click();
  await page.getByRole('button', { name: 'Mute reminders' }).click();
  await page.waitForTimeout(500);
  await card(page, 'Spotify').locator('.bell-menu summary').click();
  await page.getByRole('button', { name: 'Snooze 3 days' }).click();
  await page.waitForTimeout(500);
  await page.locator('#reminder-settings').scrollIntoViewIfNeeded();
  await flip(page, '7 days before');
  await flip(page, '1 day before');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = join(tmp, 'backup.json');
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  const bNf = backup.subscriptions.find(s => s.name === 'Netflix'), bSp = backup.subscriptions.find(s => s.name === 'Spotify');
  check('backup carries price history, mute, snooze, confidence and cycles', bNf.priceHistory.length === 2 && bNf.muted === true && /^\d{4}-\d{2}-\d{2}$/.test(bSp.snoozedUntil) && bNf.confidence > 0 && backup.subscriptions.some(s => s.cycle === 'biweekly'));
  check('backup carries the reminder windows', JSON.stringify(backup.settings.reminderDays) === '[1]');

  await page.evaluate(async () => { await new Promise(r => { const q = indexedDB.deleteDatabase('subsweep'); q.onsuccess = r; q.onblocked = r; setTimeout(r, 1500); }); });
  await page.reload({ waitUntil: 'networkidle' });
  check('wiped', (await subs(page)).length === 0);
  await page.locator('input[type=file][accept*=json]').setInputFiles(file);
  await page.waitForSelector('[role=dialog]');
  await page.getByRole('button', { name: 'Merge' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  await page.waitForTimeout(500);
  const back = await subs(page);
  const rNf = back.find(s => s.name === 'Netflix'), rSp = back.find(s => s.name === 'Spotify');
  check('restore brings back priceHistory, mute and snooze', rNf.priceHistory.length === 2 && rNf.muted === true && rSp.snoozedUntil === bSp.snoozedUntil && back.length === backup.subscriptions.length);
  await tab(page, 'List');
  check('and the reminder window setting', await page.getByLabel('1 day before').isChecked() && !(await page.getByLabel('7 days before').isChecked()));

  // everything again, offline
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  check('offline: the app opens with its data', (await subs(page)).length === backup.subscriptions.length && (await page.locator('.status-chip').isVisible()));
  await tab(page, 'List');
  await scan(page, join(tmp, 'weekly-varying.csv'));
  await page.waitForSelector('[role=dialog]');
  check('offline: the import preview works', (await page.locator('.pv-row').count()) === 1);
  await page.locator('[role=dialog]').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  await card(page, 'Apple').locator('.bell-menu summary').click();
  await page.getByRole('button', { name: 'Mute reminders' }).click();
  await page.waitForTimeout(500);
  check('offline: mute works', /Muted/.test(await card(page, 'Apple').locator('.bell-label').innerText()));
  const apple = (await subs(page)).find(s => s.name === 'Apple');
  await card(page, 'Apple').getByRole('button', { name: 'Remove' }).click();
  await page.waitForSelector('.toast');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(400);
  check('offline: delete then Undo restores it', (await subs(page)).some(s => s.id === apple.id && s.muted === true));
  await context.setOffline(false);
  await context.close();
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
