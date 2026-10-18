// End-to-end check of bulk actions, the price-history chart and the 30-day digest on the PRODUCTION build.
//   npm run build && npm run preview:prod     (one terminal)
//   node scripts/verify-bulk.mjs [url]        (another)
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const tmp = mkdtempSync(join(tmpdir(), 'subsweep-bulk-'));
let failed = 0;
const check = (name, pass, info = '') => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };

// A backup with a hand-computable digest (base INR, 1 USD = 83 INR), window = today .. today + 29.
//   Gym      weekly  100  next +2   -> +2, +9, +16, +23         4 x 100 = 400
//   Streamy  monthly 649  next +15  -> +15                      649   (also has 3 price changes, for the chart)
//   Domain   yearly  12000 next +20 -> +20                      12000
//   Insure   yearly  9999 next +200 -> none
//   Dropbox  monthly $10  next +5   -> +5                       830
//   Muted    monthly 200  next +7   -> +7 (reminders muted)     200
//   total = 400 + 649 + 12000 + 830 + 200 = 14079, over 8 payments (4 + 1 + 1 + 1 + 1)
const sub = (id, o) => ({ id, name: 'X', amount: 100, currency: 'INR', cycle: 'monthly', category: 'Other', isTrial: false, ...o });
const backup = {
  app: 'subsweep', version: 2, exportedAt: new Date().toISOString(), dismissedDuplicates: [],
  settings: { baseCurrency: 'INR', rates: { USD: 83 }, reminderDays: [7] },
  subscriptions: [
    sub(1, { name: 'Gym', amount: 100, cycle: 'weekly', nextRenewal: inDays(2) }),
    sub(2, { name: 'Streamy', amount: 649, nextRenewal: inDays(15), priceHistory: [{ date: '2026-01-10', amount: 499 }, { date: '2026-03-10', amount: 549 }, { date: '2026-06-10', amount: 599 }, { date: '2026-08-10', amount: 649 }] }),
    sub(3, { name: 'Domain', amount: 12000, cycle: 'yearly', nextRenewal: inDays(20) }),
    sub(4, { name: 'Insure', amount: 9999, cycle: 'yearly', nextRenewal: inDays(200) }),
    sub(5, { name: 'Dropbox', amount: 10, currency: 'USD', nextRenewal: inDays(5) }),
    sub(6, { name: 'Muted', amount: 200, nextRenewal: inDays(7), muted: true }),
    sub(7, { name: 'Alpha', nextRenewal: inDays(40) }), sub(8, { name: 'Bravo', nextRenewal: inDays(41) }),
    sub(9, { name: 'Charlie', nextRenewal: inDays(42) }), sub(10, { name: 'Delta', nextRenewal: inDays(43) }),
    sub(11, { name: 'Echo', nextRenewal: inDays(44) }),
  ],
};
const file = join(tmp, 'backup.json');
writeFileSync(file, JSON.stringify(backup));

const browser = await launch();
async function open({ width = 1280, height = 900, scheme = 'dark' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { context, page };
}
const subs = (page) => page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const q = r.result.transaction('subs').objectStore('subs').getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }));
const restore = async (page) => {
  await page.locator('input[type=file][accept*=json]').setInputFiles(file);
  await page.waitForSelector('[role=dialog]');
  await page.getByRole('button', { name: 'Merge' }).click();
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  await page.waitForTimeout(500);
};
const tab = async (page, name) => { await page.getByRole('tab', { name }).click(); await page.waitForTimeout(500); };
const card = (page, name) => page.locator('article.sub').filter({ has: page.locator('h3', { hasText: new RegExp('^' + name) }) });
const tick = (page, name) => page.getByLabel(`Select ${name}`).click();
const byName = (all, n) => all.find(s => s.name === n);

// ============================ 1. bulk actions ============================
{
  const { context, page } = await open();
  await restore(page);
  await tab(page, 'List');
  const original = await subs(page);

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  check('every card gets a checkbox in select mode', (await page.locator('input.sel').count()) === original.length);
  check('with nothing selected every action is disabled', await page.locator('.bulk-bar button:not(:has-text("Done")):not(:has-text("Select all"))').evaluateAll(els => els.every(e => e.disabled)) && await page.getByLabel('Set category for selected subscriptions').isDisabled());

  // 3 items: change category, then undo
  for (const n of ['Gym', 'Streamy', 'Domain']) await tick(page, n);
  check('the bar shows how many are selected', (await page.locator('.bulk-count').innerText()) === '3 selected');
  await page.getByLabel('Set category for selected subscriptions').selectOption('Gaming');
  await page.waitForSelector('.toast');
  const afterCat = await subs(page);
  check('category changed for exactly those 3', ['Gym', 'Streamy', 'Domain'].every(n => byName(afterCat, n).category === 'Gaming') && byName(afterCat, 'Dropbox').category === 'Other');
  check('selection is cleared after the action', (await page.locator('.bulk-count').innerText()) === '0 selected');
  check('toast says what happened and offers Undo', /Changed category to Gaming for 3 subscriptions/.test(await page.locator('.toast').innerText()));
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => !document.querySelector('.toast'));
  check('Undo restores the exact previous categories', JSON.stringify(await subs(page)) === JSON.stringify(original));

  // mute + mark used + Cancel?, then reload to prove they persist
  for (const n of ['Dropbox', 'Alpha']) await tick(page, n);
  await page.getByRole('button', { name: 'Mute reminders' }).click();
  await page.waitForSelector('.toast');
  for (const n of ['Dropbox', 'Bravo']) await tick(page, n);
  await page.getByRole('button', { name: 'Mark used recently' }).click();
  await page.waitForTimeout(400);
  for (const n of ['Charlie', 'Delta']) await tick(page, n);
  await page.getByRole('button', { name: 'Mark Cancel?' }).click();
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'networkidle' });
  const after = await subs(page);
  check('mute persists after a reload', byName(after, 'Dropbox').muted === true && byName(after, 'Alpha').muted === true);
  check('mark used persists after a reload', byName(after, 'Bravo').lastUsedAt === localDate() && byName(after, 'Dropbox').lastUsedAt === localDate());
  check('Mark Cancel? persists after a reload', byName(after, 'Charlie').selectedForCancel === true && byName(after, 'Delta').selectedForCancel === true);

  // delete 5: confirmation, Escape cancels, confirm deletes, Undo restores complete rows
  await tab(page, 'List');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const before5 = await subs(page);
  for (const n of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) await tick(page, n);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForSelector('[role=dialog]');
  check('deleting 5 asks first, with Cancel focused', /Delete 5 subscriptions\?/.test(await page.locator('[role=dialog] h2').innerText()) && (await page.evaluate(() => document.activeElement?.textContent)) === 'Cancel');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  check('Escape cancels the delete and keeps the selection', (await subs(page)).length === before5.length && (await page.locator('.bulk-count').innerText()) === '5 selected');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Delete 5' }).click();
  await page.waitForSelector('.toast');
  check('confirming deletes all 5', (await subs(page)).length === before5.length - 5);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => !document.querySelector('.toast'));
  const restored = await subs(page);
  check('Undo brings back the full rows, ids included', restored.length === before5.length && JSON.stringify(restored) === JSON.stringify(before5));

  // 2 or 3 items delete without a confirm dialog
  for (const n of ['Echo', 'Delta']) await tick(page, n);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForSelector('.toast');
  check('deleting 3 or fewer needs no confirmation', (await page.locator('[role=dialog]').count()) === 0 && (await subs(page)).length === before5.length - 2);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => !document.querySelector('.toast'));

  // select all + Escape
  await page.getByRole('button', { name: /^Select all \(/ }).click();
  check('Select all selects everything that is showing', (await page.locator('.bulk-count').innerText()) === `${before5.length} selected`);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  check('Clear empties the selection', (await page.locator('.bulk-count').innerText()) === '0 selected');
  await page.keyboard.press('Escape');
  check('Escape leaves select mode', (await page.locator('input.sel').count()) === 0 && (await page.evaluate(() => document.activeElement?.id)) === 'select-toggle');

  // keyboard only: Select, tick, jump to the actions, mute, then Ctrl+Z
  await page.locator('#select-toggle').focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Select Muted').focus();
  await page.keyboard.press('Space');
  check('Space ticks a card from the keyboard', (await page.locator('.bulk-count').innerText()) === '1 selected');
  await page.locator('#select-toggle').focus();
  await page.keyboard.press('Shift+Tab');
  check('there is a "Jump to actions" link', (await page.evaluate(() => document.activeElement?.textContent)) === 'Jump to actions');
  await page.keyboard.press('Enter');
  check('it moves focus to the action bar', (await page.evaluate(() => document.activeElement?.id)) === 'bulk-bar');
  await page.getByRole('button', { name: 'Mark Cancel?' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('.toast');
  check('an action works from the keyboard', byName(await subs(page), 'Muted').selectedForCancel === true);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !document.querySelector('.toast'));
  check('Ctrl+Z undoes it', byName(await subs(page), 'Muted').selectedForCancel === undefined);

  // an item changed by something else is skipped by Undo, and that is reported
  await tick(page, 'Gym'); await tick(page, 'Streamy');
  await page.getByLabel('Set category for selected subscriptions').selectOption('Music');
  await page.waitForSelector('.toast');
  await page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const tx = r.result.transaction('subs', 'readwrite'); const st = tx.objectStore('subs'); st.get(2).onsuccess = e => { const row = e.target.result; row.category = 'Software'; st.put(row); }; tx.oncomplete = () => { r.result.close(); res(); }; }; }));
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(500);
  const live = (await page.locator('[role=status].sr-only').innerText());
  check('undo skips an item edited elsewhere and says so', /Restored 1 item\. 1 item could not be restored\./.test(live), live);
  check('and does not overwrite the other edit', byName(await subs(page), 'Streamy').category === 'Software' && byName(await subs(page), 'Gym').category === 'Other');
  await context.close();
}

// the bar on the narrowest phone: no horizontal scroll, 44px targets, and it never hides the last card
{
  const { context, page } = await open({ width: 320, height: 640 });
  await restore(page);
  await tab(page, 'List');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await tick(page, 'Gym');
  const m = await page.evaluate(() => {
    const bar = document.querySelector('.bulk-bar');
    const small = [...bar.querySelectorAll('button,select')].map(e => ({ t: (e.textContent || e.getAttribute('aria-label')).slice(0, 20), h: Math.round(e.getBoundingClientRect().height), w: Math.round(e.getBoundingClientRect().width) })).filter(x => x.h < 44 || x.w < 44);
    const cards = [...document.querySelectorAll('article.sub')];
    const last = cards[cards.length - 1];
    window.scrollTo(0, document.documentElement.scrollHeight);   // the very end of the page
    const lastBottom = last.getBoundingClientRect().bottom, barTop = bar.getBoundingClientRect().top;
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, gap: Math.round(barTop - lastBottom), barH: Math.round(bar.getBoundingClientRect().height) };
  });
  check('320px, select mode: no horizontal scroll', m.over <= 0, `+${m.over}px`);
  check('320px, select mode: every bar control is at least 44x44', m.small.length === 0, JSON.stringify(m.small));
  check('320px, select mode: the bar does not cover the last card', m.gap >= -2, `gap ${m.gap}px`);
  check('320px, select mode: the bar is compact (under 90px tall), so cards stay visible', m.barH < 90, `${m.barH}px`);
  await context.close();
}

// ============================ 2. price chart ============================
{
  const { context, page } = await open({ width: 320, height: 700, scheme: 'light' });
  await restore(page);
  await tab(page, 'List');
  const btn = card(page, 'Streamy').getByRole('button', { name: 'Price history' });
  check('the Price history button appears on a card with 2+ prices', (await btn.count()) === 1);
  check('and not on a card with none', (await card(page, 'Gym').getByRole('button', { name: 'Price history' }).count()) === 0);
  await btn.click();
  await page.waitForSelector('[role=dialog] svg.pc');
  const summary = await page.locator('.pc-summary').innerText();
  check('the summary sentence is right', /Rose from .*499\.00 to .*649\.00 \(\+30%\) since Jan 2026/.test(summary), summary);
  const aria = await page.locator('svg.pc').getAttribute('aria-label');
  check('the chart is an image with the summary as its label', (await page.locator('svg.pc').getAttribute('role')) === 'img' && /Streamy price history\. Rose from/.test(aria));
  check('a real table carries the same data for screen readers (4 prices)', (await page.locator('table.sr-only tbody tr').count()) === 4 && /Price history for Streamy/.test(await page.locator('table.sr-only caption').innerText()));
  const rows = await page.locator('table.sr-only tbody tr').allInnerTexts();
  check('with the change from the previous price', /Up 10%/.test(rows[1]) && /First price/.test(rows[0]), rows.join(' | '));
  const marks = await page.locator('svg.pc .pc-mark').evaluateAll(els => els.map(e => e.tagName + ':' + e.getAttribute('class')));
  check('markers differ by shape: one circle, three triangles', marks.filter(m => m.startsWith('circle')).length === 1 && marks.filter(m => m.startsWith('polygon')).length === 3, marks.join(' '));
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const box = await page.locator('svg.pc').boundingBox();
  check('fits at 320px with no horizontal scroll', over <= 0 && box.width <= 320, `svg ${Math.round(box.width)}px, overflow ${over}`);
  check('there are no inline style attributes on the chart', (await page.locator('svg.pc [style]').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  check('Escape closes it and focus returns to the button', (await page.evaluate(() => document.activeElement?.textContent)) === 'Price history');
  await context.close();
}
{
  const { context, page } = await open({ width: 390, height: 800, scheme: 'dark' });
  await restore(page);
  await tab(page, 'List');
  await card(page, 'Streamy').getByRole('button', { name: 'Price history' }).click();
  await page.waitForSelector('svg.pc');
  const colours = await page.evaluate(() => {
    const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return { up: css('.pc-up', 'fill'), line: css('.pc-line', 'stroke'), text: css('.pc-text', 'fill'), bg: css('.modal', 'backgroundColor') };
  });
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  check('dark mode: chart text is at least 4.5:1 and markers at least 3:1', ratio(colours.text, colours.bg) >= 4.5 && ratio(colours.up, colours.bg) >= 3 && ratio(colours.line, colours.bg) >= 3, JSON.stringify({ text: ratio(colours.text, colours.bg).toFixed(1), up: ratio(colours.up, colours.bg).toFixed(1) }));
  await context.close();
}

// ============================ 3. 30-day digest ============================
{
  const { context, page } = await open();
  await restore(page);
  await tab(page, 'Next 30 days');
  const stat = (label) => page.locator('.digest .summary .stat', { hasText: label }).locator('strong').innerText();
  const total = await stat('Due in 30 days');
  check('the 30-day total matches the hand calculation (14,079)', /14,079\.00/.test(total) && !/14,0790/.test(total), total);
  check('and counts 8 payments (4 weekly + Streamy, Domain, Dropbox, Muted)', (await stat('Payments')) === '8');
  check('the yearly item outside the window is not counted', (await page.locator('.digest').innerText()).indexOf('Insure') === -1);
  check('the muted item is included and marked', /Reminders muted/.test(await page.locator('.digest-row', { hasText: 'Muted' }).innerText()));
  check('a note explains muted items are included', /still cost/.test(await page.locator('.digest').innerText()));
  const busiest = await stat('Busiest week');
  check('the busiest week is the one with the yearly Domain payment', /12,/.test(busiest), busiest);
  const weekTotals = await page.locator('.card.week > .row strong').allInnerTexts();
  check('every week of the window is listed (5 weeks)', weekTotals.length >= 5 && weekTotals.length <= 6, String(weekTotals.length));

  await page.getByRole('button', { name: 'Copy summary' }).click();
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Copy summary puts plain text on the clipboard', /^SubSweep: next 30 days/.test(clip) && /Total due: .*14,079\.00 across 8 payments/.test(clip), clip.split('\n')[1]);
  check('and says so in the live region', /Copied the 30-day summary/.test(await page.locator('[role=status].sr-only').innerText()));

  await page.emulateMedia({ media: 'print' });
  check('print view hides the header, tabs and buttons', !(await page.locator('header.top').isVisible()) && !(await page.locator('.view-switch').isVisible()) && !(await page.getByRole('button', { name: 'Copy summary' }).isVisible()));
  check('and keeps the digest', await page.locator('.digest .summary').isVisible() && (await page.locator('.card.week').first().isVisible()));
  await page.emulateMedia({ media: 'screen' });

  // keyboard only: tabs, then the digest buttons
  await page.getByRole('tab', { name: 'Next 30 days' }).focus();
  await page.keyboard.press('ArrowRight');
  check('arrow keys still move between all four tabs', (await page.getByRole('tab', { name: 'List' }).getAttribute('aria-selected')) === 'true');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'Copy summary' }).focus();
  check('digest actions are focusable', (await page.evaluate(() => document.activeElement?.textContent)) === 'Copy summary');
  await context.close();
}
{
  // clipboard blocked: the summary opens in a dialog, selected, so it can still be copied by hand
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } }); });
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await restore(page);
  await tab(page, 'Next 30 days');
  await page.getByRole('button', { name: 'Copy summary' }).click();
  await page.waitForSelector('[role=dialog] textarea');
  check('with the clipboard blocked, the summary opens in a text box to copy by hand', /Total due:/.test(await page.locator('[role=dialog] textarea').inputValue()));
  await context.close();
}
{
  const { context, page } = await open();
  await tab(page, 'Next 30 days');
  check('an empty digest says so kindly', /Nothing is due in the next 30 days/.test(await page.locator('.digest').innerText()));
  await context.close();
}

// ============================ 4. v0.6 data loads, and everything works offline ============================
{
  const { context, page } = await open();
  await page.evaluate(async ({ n2 }) => {
    await new Promise(r => { const q = indexedDB.deleteDatabase('subsweep'); q.onsuccess = r; q.onblocked = r; setTimeout(r, 1500); });
    await new Promise((res, rej) => {
      const req = indexedDB.open('subsweep', 50);      // Dexie v5 = IndexedDB version 50 (what v0.6 wrote)
      req.onupgradeneeded = () => {
        const d = req.result;
        const s = d.createObjectStore('subs', { keyPath: 'id', autoIncrement: true }); s.createIndex('name', 'name'); s.createIndex('nextRenewal', 'nextRenewal');
        const dd = d.createObjectStore('dismissedDuplicates', { keyPath: 'id', autoIncrement: true }); dd.createIndex('key', 'key', { unique: true });
        d.createObjectStore('settings', { keyPath: 'key' }); d.createObjectStore('notifiedReminders', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const tx = req.result.transaction(['subs', 'settings'], 'readwrite');
        tx.objectStore('subs').add({ name: 'Netflix', amount: 649, currency: 'INR', cycle: 'monthly', nextRenewal: n2, category: 'Streaming', isTrial: false, priceHistory: [{ date: '2026-01-01', amount: 499 }, { date: '2026-06-01', amount: 649 }], confidence: 0.9, importBatchId: 'import-x', muted: true });
        tx.objectStore('settings').put({ key: 'baseCurrency', value: 'INR' });
        tx.objectStore('settings').put({ key: 'reminderDays', value: [1, 3] });
        tx.oncomplete = () => { req.result.close(); res(); };
      };
      req.onerror = rej;
    });
  }, { n2: inDays(4) });
  await page.reload({ waitUntil: 'networkidle' });
  await tab(page, 'List');
  const rows = await subs(page);
  const ver = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const v = r.result.version; r.result.close(); res(v); }; }));
  check('v0.6 data loads untouched (no schema change in this release)', rows.length === 1 && rows[0].muted === true && rows[0].priceHistory.length === 2 && ver === 50, `db version ${ver}`);
  check('its price chart works', (await card(page, 'Netflix').getByRole('button', { name: 'Price history' }).count()) === 1);
  await tab(page, 'Next 30 days');
  check('and the digest includes it', /649\.00/.test(await page.locator('.digest .summary').innerText()));
  await context.close();
}
{
  const { context, page } = await open();
  await restore(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  await tab(page, 'Next 30 days');
  check('offline: the digest works', /14,079\.00/.test(await page.locator('.digest .summary').innerText()));
  await tab(page, 'List');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await tick(page, 'Gym');
  await page.getByRole('button', { name: 'Mute reminders' }).click();
  await page.waitForSelector('.toast');
  check('offline: a bulk action works', byName(await subs(page), 'Gym').muted === true);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(400);
  check('offline: and so does its Undo', byName(await subs(page), 'Gym').muted === undefined);
  await page.keyboard.press('Escape');
  await card(page, 'Streamy').getByRole('button', { name: 'Price history' }).click();
  check('offline: the price chart renders', (await page.locator('svg.pc').count()) === 1);
  await context.setOffline(false);
  await context.close();
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
