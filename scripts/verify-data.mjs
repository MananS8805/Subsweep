// End-to-end check of payment methods, CSV export and first-run onboarding on the PRODUCTION build.
//   npm run build && npm run preview:prod     (one terminal)
//   node scripts/verify-data.mjs [url]        (another)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const tmp = mkdtempSync(join(tmpdir(), 'subsweep-data-'));
let failed = 0;
const check = (name, pass, info = '') => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };
const sub = (id, o) => ({ id, name: 'X', amount: 100, currency: 'INR', cycle: 'monthly', nextRenewal: inDays(10), category: 'Other', isTrial: false, ...o });
const write = (name, obj) => { const f = join(tmp, name); writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
const mk = (settings, subscriptions) => ({ app: 'subsweep', version: 2, exportedAt: new Date().toISOString(), dismissedDuplicates: [], settings, subscriptions });

const browser = await launch();
async function open({ width = 1280, height = 900, scheme = 'dark' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, acceptDownloads: true });
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { context, page };
}
const idb = (page, store) => page.evaluate((st) => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const q = r.result.transaction(st).objectStore(st).getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }), store);
const subs = (page) => idb(page, 'subs');
const settings = async (page) => Object.fromEntries((await idb(page, 'settings')).map(r => [r.key, r.value]));
const dlg = (page) => page.getByRole('dialog');
const closed = (page) => page.waitForSelector('[role=dialog]', { state: 'detached' });
const tab = async (page, name) => { await page.getByRole('tab', { name }).click(); await page.waitForTimeout(400); };
const card = (page, name) => page.locator('article.sub').filter({ has: page.locator('h3', { hasText: new RegExp('^' + name) }) });
const restore = async (page, f) => {
  await page.locator('input[type=file][accept*=json]').setInputFiles(f);
  await dlg(page).waitFor();
  await page.getByRole('button', { name: 'Merge into my data' }).click(); await closed(page); await page.waitForTimeout(500);
};
const wipe = async (page) => { await page.evaluate(async () => { await new Promise(r => { const q = indexedDB.deleteDatabase('subsweep'); q.onsuccess = r; q.onblocked = r; setTimeout(r, 1500); }); }); await page.reload({ waitUntil: 'networkidle' }); };

// ============================ 1. onboarding ============================
{
  const { context, page } = await open();
  const welcome = page.getByRole('region', { name: 'Welcome to SubSweep' });
  check('a new user sees the welcome panel', await welcome.isVisible());
  check('with the three actions and the privacy line', (await welcome.getByRole('button').count()) === 4 && /Nothing is uploaded/.test(await welcome.innerText()));
  check('welcome panel has a heading', (await page.getByRole('heading', { name: 'Welcome to SubSweep' }).count()) === 1);
  // keyboard order: Tab walks scan -> add -> sample -> skip
  await welcome.getByRole('button', { name: 'Scan a bank statement CSV' }).focus();
  const order = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.textContent)); }
  check('focus order inside the panel is logical', order.join('|') === 'Add one manually|Try with sample data|Skip');
  const small = await welcome.getByRole('button').evaluateAll(els => els.every(e => e.getBoundingClientRect().height >= 40));
  check('targets are tall enough', small);

  await welcome.getByRole('button', { name: 'Add one manually' }).click();
  check('Add one manually opens quick-add', /Quick add/.test(await dlg(page).innerText()));
  await page.keyboard.press('Escape'); await closed(page);

  await welcome.getByRole('button', { name: 'Try with sample data' }).click();
  await page.waitForSelector('text=fake sample data');
  check('sample data loads and the welcome panel goes', (await welcome.count()) === 0 && (await subs(page)).length === 14);
  await tab(page, 'List');
  check('items show a Sample chip', (await page.locator('.sample-chip').count()) === 14);
  check('the sample banner is visible', await page.locator('.banner.sample').isVisible());
  check('onboarding is remembered as dismissed', (await settings(page)).onboardingDismissed === true);

  // samples are not exported
  await page.getByRole('button', { name: 'Export CSV' }).click();
  check('exporting only samples says there is nothing to export', /Nothing to export yet/.test(await page.locator('.notice').innerText()));
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const dumped = JSON.parse(readFileSync(await bk.path(), 'utf8'));
  check('a backup leaves samples out', dumped.subscriptions.length === 0 && dumped.settings.sampleIds === undefined);

  // remove with undo
  await page.locator('.banner.sample').getByRole('button', { name: 'Remove sample data' }).click();
  await page.waitForSelector('.toast');
  check('removing samples empties the list', (await subs(page)).length === 0);
  check('and the welcome does not return', (await welcome.count()) === 0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(500);
  check('Undo brings every sample row back', (await subs(page)).length === 14 && (await settings(page)).sampleIds.length === 14);
  await page.locator('.banner.sample').getByRole('button', { name: 'Remove sample data' }).click(); await page.waitForTimeout(500);
  check('removing again leaves only real data (none)', (await subs(page)).length === 0);

  // show again
  await page.getByRole('button', { name: 'Show welcome again' }).click(); await page.waitForTimeout(400);
  check('Show welcome again brings the panel back for an empty SubSweep', await welcome.isVisible());
  await welcome.getByRole('button', { name: 'Skip' }).click(); await page.waitForTimeout(400);
  check('Skip hides it', (await welcome.count()) === 0 && (await settings(page)).onboardingDismissed === true);

  // a real first item: welcome never returns
  await wipe(page);
  check('after clearing site data the welcome is back', await welcome.isVisible());
  await page.locator('button.add-top').click();
  await page.getByRole('dialog').getByLabel('Name').fill('First'); await page.getByRole('dialog').getByLabel('Amount').fill('5');
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await closed(page); await page.waitForTimeout(500);
  check('adding a first item hides it', (await welcome.count()) === 0);
  await page.getByRole('button', { name: 'Show welcome again' }).click();
  check('with items present it does not reappear', (await welcome.count()) === 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const t = r.result.transaction('subs', 'readwrite'); t.objectStore('subs').clear(); t.oncomplete = () => { r.result.close(); res(); }; }; }));
  await context.close();
}

// ============================ 2. payment methods ============================
{
  const { context, page } = await open();
  await restore(page, write('pm.json', mk({ baseCurrency: 'INR', rates: { USD: 80 } }, [
    sub(1, { name: 'Alpha', amount: 1000, paymentMethod: 'Visa ending 4242' }),
    sub(2, { name: 'Bravo', amount: 10, currency: 'USD' }),
    sub(3, { name: 'Charlie', amount: 500, paymentMethod: 'UPI' }),
    sub(4, { name: 'Delta', amount: 200 }),
    sub(5, { name: 'Echo', amount: 5, currency: 'EUR' }),
  ])));
  await tab(page, 'List');

  // quick-add: rejected card number, then accepted nickname with canonical casing
  await page.keyboard.press('n');
  await dlg(page).getByLabel('Name').fill('Foxtrot'); await dlg(page).getByLabel('Amount').fill('50');
  await dlg(page).getByLabel('Payment method').fill('4242 4242 4242 4242');
  check('a card number is refused in a live region', /looks like a card number/.test(await dlg(page).innerText()) && /nickname like Visa ending 4242/.test(await dlg(page).innerText()));
  await dlg(page).getByRole('button', { name: 'Add', exact: true }).click();
  check('and saving is blocked', (await dlg(page).count()) === 1 && (await subs(page)).every(s => s.name !== 'Foxtrot'));
  await dlg(page).getByLabel('Payment method').fill('  visa ENDING 4242 ');
  await dlg(page).getByRole('button', { name: 'Add', exact: true }).click(); await closed(page); await page.waitForTimeout(500);
  check('same label in other casing reuses the first spelling', (await subs(page)).find(s => s.name === 'Foxtrot').paymentMethod === 'Visa ending 4242');

  check('cards show the label chip', (await card(page, 'Alpha').locator('.pay-chip').innerText()).includes('Visa ending 4242'));

  // filter
  const filter = page.getByLabel('Filter by payment method');
  await filter.selectOption('Visa ending 4242');
  check('filtering by one label shows only those', (await page.locator('article.sub').count()) === 2);
  await page.keyboard.press('Escape');
  await page.getByLabel('Filter subscriptions').fill('foxtrot');
  check('the name search combines with the payment filter', (await page.locator('article.sub').count()) === 1);
  await page.getByLabel('Filter subscriptions').fill('delta');
  check('no results shows an empty state with Clear filters', /No subscriptions match/.test(await page.locator('.empty-state').innerText()));
  await page.getByRole('button', { name: 'Clear filters' }).click();
  check('Clear filters restores the full list', (await page.locator('article.sub').count()) === 6);
  await filter.selectOption('none');
  check('the None filter shows unlabelled ones', (await page.locator('article.sub').count()) === 3);
  await filter.selectOption('all');

  // breakdown: Visa = 1000 + 50 = 1050, UPI = 500, No label = Delta 200 + Bravo 800 = 1000 (+ Echo rate needed)
  const rows = await page.locator('#by-method-title').locator('xpath=..').locator('.bar-row').allInnerTexts();
  const find = (l) => rows.find(r => r.startsWith(l)) ?? '';
  check('Visa breakdown matches a calculator (1,050)', /1,050/.test(find('Visa ending 4242')));
  check('UPI breakdown matches (500)', /500/.test(find('UPI')));
  check('No label row matches (1,000) and flags the missing rate', /1,000/.test(find('No label')) && /1 rate needed/.test(find('No label')));

  // bulk set + undo
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  for (const n of ['Delta', 'Bravo']) await page.getByLabel(`Select ${n}`).click();
  await page.getByRole('button', { name: 'Set payment method' }).click();
  await dlg(page).getByLabel('Payment method').fill('1234567890123456');
  check('the bulk dialog also refuses a card number', await dlg(page).getByRole('button', { name: /Set for/ }).isDisabled());
  await dlg(page).getByLabel('Payment method').fill('cash');
  await dlg(page).getByRole('button', { name: 'Set for 2' }).click(); await closed(page); await page.waitForSelector('.toast');
  let all = await subs(page);
  check('bulk set labels exactly those two', ['Delta', 'Bravo'].every(n => all.find(s => s.name === n).paymentMethod === 'cash') && !all.find(s => s.name === 'Echo').paymentMethod);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(500);
  all = await subs(page);
  check('Undo removes the label again', ['Delta', 'Bravo'].every(n => all.find(s => s.name === n).paymentMethod === undefined));

  // backup round trip keeps the label
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const dumped = JSON.parse(readFileSync(await bk.path(), 'utf8'));
  check('the backup carries payment methods', dumped.subscriptions.find(s => s.name === 'Alpha').paymentMethod === 'Visa ending 4242' && dumped.version === 2);
  await context.close();
}

// ============================ 3. CSV export ============================
{
  const { context, page } = await open();
  await restore(page, write('csv.json', mk({ baseCurrency: 'INR', rates: { USD: 80 } }, [
    sub(1, { name: '=HYPERLINK("http://x")', amount: 100, notes: 'line1\nline2, "quoted"', paymentMethod: 'Visa 4242' }),
    sub(2, { name: 'Café Münchën ☕', amount: 10, currency: 'USD', nextRenewal: inDays(3) }),
    sub(3, { name: 'Euro one', amount: 5, currency: 'EUR', nextRenewal: inDays(4) }),
    sub(4, { name: 'Trial', isTrial: true, nextRenewal: inDays(6) }),
  ])));
  await tab(page, 'List');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  check('the file is named with the local date', dl.suggestedFilename() === `subsweep-subscriptions-${localDate()}.csv`);
  const buf = readFileSync(await dl.path());
  check('it starts with a UTF-8 BOM', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
  const text = buf.toString('utf8').replace(/^﻿/, '');
  check('the header matches the documented columns', text.split('\r\n')[0] === 'name,category,amount,currency,cycle,next_renewal,monthly_base,yearly_base,base_currency,payment_method,trial,cancel_flag,muted,last_reviewed,notes');
  check('a formula-looking name is neutralised', text.includes(`"'=HYPERLINK(""http://x"")"`));
  check('non-ASCII names survive', text.includes('Café Münchën ☕'));
  check('commas, quotes and newlines in notes are quoted', text.includes('"line1\nline2, ""quoted"""'));
  const euro = text.split('\r\n').find(l => l.startsWith('Euro one'));
  check('a missing rate leaves monthly_base empty', /,EUR,monthly,[^,]*,,,INR,/.test(euro), euro);
  const usd = text.split('\r\n').find(l => l.startsWith('Café'));
  check('money uses a dot and 2 places', /,10\.00,USD,monthly,[^,]*,800\.00,9600\.00,INR,/.test(usd), usd);

  await tab(page, 'Next 30 days');
  const shown = await page.locator('.summary .stat').filter({ hasText: 'Payments' }).locator('strong').innerText();
  const [dd] = await Promise.all([page.waitForEvent('download'), page.getByRole('tabpanel').getByRole('button', { name: 'Export CSV' }).click()]);
  check('the digest file is named with the local date', dd.suggestedFilename() === `subsweep-next30-${localDate()}.csv`);
  const rows = readFileSync(await dd.path(), 'utf8').replace(/^﻿/, '').split('\r\n').filter(Boolean).slice(1);
  const payments = rows.filter(r => /,(normal|muted)$/.test(r));
  check('digest payment rows equal the payments on screen', payments.length === Number(shown), `${payments.length} vs ${shown}`);
  check('trials and rate-needed rows are marked', rows.some(r => r.endsWith(',trial')) && rows.some(r => r.endsWith(',rate_needed')));
  await context.close();
}

// ============================ 4. empty states, offline, 320px ============================
{
  const { context, page } = await open({ width: 320, height: 700, scheme: 'light' });
  await page.getByRole('button', { name: 'Skip' }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Export CSV' }).click();
  check('empty export shows a message and downloads nothing', /Nothing to export yet/.test(await page.locator('.notice').innerText()));
  await page.locator('button.fab').click();
  await dlg(page).getByLabel('Name').fill('Solo'); await dlg(page).getByLabel('Amount').fill('9'); await dlg(page).getByLabel('Next renewal').fill(inDays(90));
  await dlg(page).getByRole('button', { name: 'Add', exact: true }).click(); await closed(page); await page.waitForTimeout(400);
  check('with one subscription Insights explains what it needs', /Insights need a few more subscriptions/.test(await page.locator('.empty-state').first().innerText()));
  await tab(page, 'Next 30 days');
  await page.waitForTimeout(300);
  check('Next 30 days has its own empty state when nothing is due', /Nothing is due in the next 30 days/.test(await page.locator('#view-panel').innerText()));
  await page.keyboard.press('r');
  check('review with a fresh item opens the dialog', (await dlg(page).count()) === 1);
  await page.keyboard.press('Escape'); await closed(page);
  check('no horizontal overflow at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('everything is still there offline', (await page.locator('article.sub, .empty-state, h1').count()) > 0);
  await context.setOffline(false);
  await context.close();
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
