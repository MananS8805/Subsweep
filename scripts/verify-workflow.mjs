// End-to-end check of settings in backups + restore preview, keyboard shortcuts + quick-add, and notes + monthly review,
// on the PRODUCTION build.
//   npm run build && npm run preview:prod     (one terminal)
//   node scripts/verify-workflow.mjs [url]    (another)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const tmp = mkdtempSync(join(tmpdir(), 'subsweep-workflow-'));
let failed = 0;
const check = (name, pass, info = '') => { if (!pass) failed++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDate(d); };

const sub = (id, o) => ({ id, name: 'X', amount: 100, currency: 'INR', cycle: 'monthly', nextRenewal: inDays(20), category: 'Other', isTrial: false, ...o });
const mkBackup = (settings, subscriptions) => ({ app: 'subsweep', version: 2, exportedAt: new Date().toISOString(), dismissedDuplicates: [], settings, subscriptions });
const write = (name, obj) => { const f = join(tmp, name); writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };

const browser = await launch();
async function open({ width = 1280, height = 900, scheme = 'dark' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { context, page };
}
const idb = (page, store) => page.evaluate((st) => new Promise(res => { const r = indexedDB.open('subsweep'); r.onsuccess = () => { const q = r.result.transaction(st).objectStore(st).getAll(); q.onsuccess = () => { r.result.close(); res(q.result); }; }; }), store);
const subs = (page) => idb(page, 'subs');
const settings = async (page) => Object.fromEntries((await idb(page, 'settings')).map(r => [r.key, r.value]));
const tab = async (page, name) => { await page.getByRole('tab', { name }).click(); await page.waitForTimeout(400); };
const card = (page, name) => page.locator('article.sub').filter({ has: page.locator('h3', { hasText: new RegExp('^' + name) }) });
const dlg = (page) => page.getByRole('dialog');
const pickFile = async (page, f) => { await page.locator('input[type=file][accept*=json]').setInputFiles(f); await dlg(page).waitFor(); await page.waitForTimeout(300); };
const closed = (page) => page.waitForSelector('[role=dialog]', { state: 'detached' });

// ============================ 1. settings in backup + restore preview ============================
{
  const { context, page } = await open();
  // an existing setup: EUR base, a 3-day reminder, one subscription
  const seedFile = write('seed.json', mkBackup({ baseCurrency: 'EUR', reminderDays: [3], rates: { USD: 0.9 } }, [sub(1, { name: 'Mine', currency: 'EUR' })]));
  await pickFile(page, seedFile);
  await page.getByRole('radio', { name: 'Replace' }).check();
  await page.getByLabel('I understand').check();
  await page.getByRole('button', { name: 'Replace and restore' }).click();
  await closed(page); await page.waitForTimeout(400);
  const s0 = await settings(page);
  check('Replace restores the settings in the file', s0.baseCurrency === 'EUR' && JSON.stringify(s0.reminderDays) === '[3]');

  // download a backup and check it has the settings
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const dumped = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  check('the downloaded backup includes the settings', dumped.settings.baseCurrency === 'EUR' && JSON.stringify(dumped.settings.reminderDays) === '[3]' && dumped.version === 2);

  // preview: merge a file with different settings; the preview must not change anything
  const other = write('other.json', mkBackup({ baseCurrency: 'INR', reminderDays: [1, 7] }, [sub(1, { name: 'Dup id' }), sub(2, { name: 'Fresh' })]));
  const before = JSON.stringify([await subs(page), await settings(page)]);
  await pickFile(page, other);
  const text = await dlg(page).innerText();
  check('preview shows 1 to add and 1 to skip', /1 will be added/.test(text) && /1 will be skipped/.test(text));
  check('preview lists the setting that would differ and says it is kept (merge default)', /Base currency/.test(text) && /Kept as it is/.test(text));
  check('opening the preview wrote nothing', JSON.stringify([await subs(page), await settings(page)]) === before);
  await dlg(page).getByRole('button', { name: 'Cancel', exact: true }).click(); await closed(page);
  check('cancelling the preview leaves everything untouched', JSON.stringify([await subs(page), await settings(page)]) === before);

  // merge without the tick keeps settings; with the tick overwrites
  await pickFile(page, other);
  await page.getByRole('button', { name: 'Merge into my data' }).click(); await closed(page); await page.waitForTimeout(400);
  const s1 = await settings(page);
  check('merge keeps existing settings, fills ones not set', s1.baseCurrency === 'EUR' && JSON.stringify(s1.reminderDays) === '[3]');
  check('and adds the missing subscription only', (await subs(page)).map(s => s.name).sort().join() === 'Fresh,Mine');
  await pickFile(page, other);
  await page.getByLabel('Also overwrite my settings').check();
  await page.getByRole('button', { name: 'Merge into my data' }).click(); await closed(page); await page.waitForTimeout(400);
  const s2 = await settings(page);
  check('ticking the box overwrites settings in merge', s2.baseCurrency === 'INR' && JSON.stringify(s2.reminderDays) === '[1,7]');

  // an old backup without settings changes none
  const old = write('old.json', { app: 'subsweep', version: 1, subscriptions: [] });
  await pickFile(page, old);
  check('a backup with no settings says so', /no settings/.test(await dlg(page).innerText()));
  await page.getByRole('radio', { name: 'Replace' }).check();
  await page.getByLabel('I understand').check();
  await page.getByRole('button', { name: 'Replace and restore' }).click(); await closed(page); await page.waitForTimeout(400);
  const s3 = await settings(page);
  check('restoring it leaves settings untouched', s3.baseCurrency === 'INR' && JSON.stringify(s3.reminderDays) === '[1,7]');

  // bad rates are reported and not applied
  const bad = write('bad.json', mkBackup({ rates: { USD: -5 }, baseCurrency: 'dollars' }, []));
  await pickFile(page, bad);
  const btext = await dlg(page).innerText();
  check('malformed settings are shown as warnings', /Ignored/.test(btext) && /not a positive number/.test(btext));
  await dlg(page).getByRole('button', { name: 'Cancel', exact: true }).click(); await closed(page);

  // not a backup at all
  await pickFile(page, write('junk.json', '{"hello": 1}'));
  check('a non-SubSweep file gets a readable error and no restore button', /not a SubSweep backup/.test(await dlg(page).innerText()) && (await dlg(page).getByRole('button', { name: /restore|merge/i }).count()) === 0);
  await page.keyboard.press('Escape'); await closed(page);

  // keyboard: Escape closes the preview
  await pickFile(page, other);
  check('focus is inside the preview dialog', await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')));
  await page.keyboard.press('Escape'); await closed(page);
  await context.close();
}

// ============================ 2. shortcuts + quick-add ============================
{
  const { context, page } = await open();
  await pickFile(page, write('base.json', mkBackup({ baseCurrency: 'INR' }, [sub(1, { name: 'Netflix', amount: 649 }), sub(2, { name: 'Gym', amount: 1000 })])));
  await page.getByRole('button', { name: 'Merge into my data' }).click(); await closed(page); await page.waitForTimeout(400);
  await tab(page, 'List');

  await page.locator('h1').click();
  await page.keyboard.press('n');
  check('N opens quick-add', (await dlg(page).count()) === 1 && /Quick add/.test(await dlg(page).innerText()));
  check('quick-add focuses the name field', await page.evaluate(() => document.activeElement?.tagName === 'INPUT'));
  await page.keyboard.type('Test Sub');
  check('typing n inside a field does not trigger anything', (await page.getByRole('dialog').getByLabel('Name').inputValue()) === 'Test Sub' && (await dlg(page).count()) === 1);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  check('an empty amount is rejected with a readable message', /amount greater than 0/.test(await dlg(page).innerText()));
  await page.getByLabel('Amount').fill('50');
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await closed(page); await page.waitForTimeout(400);
  const added = (await subs(page)).find(s => s.name === 'Test Sub');
  check('quick-add saved with a currency and category', added && added.currency === 'INR' && added.amount === 50 && !!added.category);

  // lookalike warning
  await page.keyboard.press('n');
  await page.getByLabel('Name').fill('Netflix'); await page.getByLabel('Amount').fill('649');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  check('a lookalike is warned about, not saved yet', /already track/.test(await dlg(page).innerText()) && (await subs(page)).filter(s => s.name === 'Netflix').length === 1);
  await page.getByRole('button', { name: 'Add anyway' }).click(); await closed(page); await page.waitForTimeout(300);
  check('Add anyway saves it', (await subs(page)).filter(s => s.name === 'Netflix').length === 2);

  // shortcuts do nothing under a dialog
  await page.keyboard.press('?');
  check('? opens the cheat sheet', /Keyboard shortcuts/.test(await dlg(page).innerText()));
  await page.keyboard.press('n');
  check('N does nothing while a dialog is open', (await dlg(page).count()) === 1 && /Keyboard shortcuts/.test(await dlg(page).innerText()));
  await page.keyboard.press('Escape'); await closed(page);

  // view navigation
  await page.keyboard.press('g'); await page.keyboard.press('y');
  check('G then Y goes to Yearly', await page.getByRole('tab', { name: 'Yearly' }).getAttribute('aria-selected') === 'true');
  await page.keyboard.press('g'); await page.waitForTimeout(1300); await page.keyboard.press('l');
  check('G then wait then L does nothing (sequence timed out)', await page.getByRole('tab', { name: 'Yearly' }).getAttribute('aria-selected') === 'true');
  await page.keyboard.press('g'); await page.keyboard.press('l');
  check('G then L goes to List', await page.getByRole('tab', { name: 'List' }).getAttribute('aria-selected') === 'true');

  // filter
  await page.keyboard.press('/'); await page.waitForTimeout(150);
  check('/ focuses the filter', await page.evaluate(() => document.activeElement?.id === 'name-filter'));
  await page.keyboard.type('gym');
  check('the filter narrows the list', (await page.locator('article.sub').count()) === 1);
  await page.keyboard.press('Escape');
  check('Escape clears the filter and leaves the field', (await page.locator('article.sub').count()) === 4 && await page.evaluate(() => document.activeElement?.id !== 'name-filter'));

  // discoverable by mouse
  await page.getByRole('contentinfo').getByRole('button', { name: 'Keyboard shortcuts' }).click();
  check('the footer button opens the cheat sheet', /Keyboard shortcuts/.test(await dlg(page).innerText()));
  await page.keyboard.press('Escape'); await closed(page);
  await context.close();
}

// ============================ 3. notes + monthly review ============================
{
  const { context, page } = await open();
  const old = localDate(new Date(Date.now() - 45 * 86400000));
  await pickFile(page, write('rev.json', mkBackup({ baseCurrency: 'INR' }, [
    sub(1, { name: 'Alpha', amount: 900 }),
    sub(2, { name: 'Bravo', amount: 500, lastReviewedAt: old }),
    sub(3, { name: 'Charlie', amount: 100, lastReviewedAt: localDate() }),
    sub(4, { name: 'Delta', amount: 50, notes: '<b>shared</b> with Sam' }),
  ])));
  await page.getByRole('button', { name: 'Merge into my data' }).click(); await closed(page); await page.waitForTimeout(400);
  await tab(page, 'List');

  check('a note shows on its card as plain text', (await card(page, 'Delta').locator('.note-text').innerText()).includes('<b>shared</b> with Sam'));
  check('the review card says 3 are due (Charlie was reviewed today)', /3 subscriptions have not been reviewed/.test(await page.locator('.review-card').innerText()));

  // notes in the edit form
  await card(page, 'Charlie').getByRole('button', { name: 'Edit' }).click();
  const area = dlg(page).getByLabel('Notes');
  await area.fill('x'.repeat(600));
  check('the notes box stops at 500 characters and shows a counter', (await area.inputValue()).length === 500 && /500 \/ 500/.test(await dlg(page).innerText()));
  await area.fill('annual plan, ask for discount');
  await dlg(page).getByRole('button', { name: 'Save' }).click(); await closed(page); await page.waitForTimeout(300);
  check('the note was saved', (await subs(page)).find(s => s.name === 'Charlie').notes === 'annual plan, ask for discount');

  // mark reviewed + undo
  await card(page, 'Alpha').getByRole('button', { name: 'Mark reviewed' }).click();
  await page.waitForSelector('.toast');
  check('Mark reviewed stamps today', (await subs(page)).find(s => s.name === 'Alpha').lastReviewedAt === localDate());
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(300);
  check('Undo removes the stamp again', (await subs(page)).find(s => s.name === 'Alpha').lastReviewedAt === undefined);

  // the review
  await page.locator('.review-card').getByRole('button', { name: 'Start review' }).click();
  check('the review starts with the most expensive', /Alpha/.test(await dlg(page).innerText()) && /1 of 3/.test(await dlg(page).innerText()));
  await dlg(page).getByRole('button', { name: 'Keep' }).click();
  await dlg(page).getByRole('button', { name: 'Cancel?' }).click();
  await page.waitForTimeout(300);
  check('it moves through the queue', /3 of 3/.test(await dlg(page).innerText()));
  await dlg(page).getByRole('button', { name: 'Skip' }).click();
  check('it finishes with a summary', /Kept 1, marked 1 to cancel, skipped 1/.test(await dlg(page).innerText()));
  await dlg(page).getByRole('button', { name: 'Done' }).click(); await closed(page); await page.waitForTimeout(400);
  const after = await subs(page);
  const a = after.find(s => s.name === 'Alpha'), b = after.find(s => s.name === 'Bravo'), d = after.find(s => s.name === 'Delta');
  check('Keep stamped Alpha, Cancel? stamped and flagged Bravo, Skip left Delta alone', a.lastReviewedAt === localDate() && b.lastReviewedAt === localDate() && b.selectedForCancel === true && d.lastReviewedAt === undefined && !d.selectedForCancel);
  check('the prompt is gone once nothing is due but the skipped one', /1 subscription has not been reviewed/.test(await page.locator('.review-card').innerText()));

  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(400);
  const undone = await subs(page);
  check('Undo puts every reviewed subscription back exactly', undone.find(s => s.name === 'Alpha').lastReviewedAt === undefined && undone.find(s => s.name === 'Bravo').lastReviewedAt === old && !undone.find(s => s.name === 'Bravo').selectedForCancel);

  // snooze the prompt
  await page.locator('.review-card').getByRole('button', { name: 'Not now' }).click(); await page.waitForTimeout(300);
  check('Not now hides the card and stores a snooze date', (await page.locator('.review-card').count()) === 0 && /^\d{4}-\d{2}-\d{2}$/.test((await settings(page)).reviewPromptDismissedUntil));
  await page.reload({ waitUntil: 'networkidle' });
  check('and it stays hidden after a reload', (await page.locator('.review-card').count()) === 0);

  // notes + lastReviewedAt survive a backup round trip
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const dumped = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  check('the backup carries notes and lastReviewedAt', dumped.subscriptions.find(s => s.name === 'Charlie').notes === 'annual plan, ask for discount' && !!dumped.subscriptions.find(s => s.name === 'Charlie').lastReviewedAt && !!dumped.settings.reviewPromptDismissedUntil);
  await context.close();
}

// ============================ 4. offline + small screen ============================
{
  const { context, page } = await open({ width: 320, height: 700, scheme: 'light' });
  await pickFile(page, write('m.json', mkBackup({ baseCurrency: 'INR' }, [sub(1, { name: 'Alpha' })])));
  await page.getByRole('button', { name: 'Merge into my data' }).click(); await closed(page); await page.waitForTimeout(400);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await tab(page, 'List');
  check('review card works offline', (await page.locator('.review-card').count()) === 1);
  await page.locator('.review-card').getByRole('button', { name: 'Start review' }).click();
  check('review dialog fits at 320px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await dlg(page).getByRole('button', { name: 'Keep' }).click();
  await dlg(page).getByRole('button', { name: 'Done' }).click(); await closed(page);
  await page.getByRole('button', { name: /Add subscription/ }).click();
  check('quick-add opens from the phone button and fits', (await dlg(page).count()) === 1 && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const hint = await page.locator('.kbd-hint').first().evaluate(e => getComputedStyle(e).display).catch(() => 'none');
  check('the N hint is hidden on small screens', hint === 'none');
  await context.setOffline(false);
  await context.close();
}

await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
