// Regenerates the README screenshots in docs/screenshots from the running PRODUCTION build.
// Every page starts with an empty profile and is filled through the app's own "Load sample data" button,
// so the images show exactly what a visitor gets. Needs a Chrome/Edge install (scripts/browser.mjs).
//   npm run build && npm run preview:prod     (one terminal)
//   npm run screenshots [url]                 (another)
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './browser.mjs';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(OUT, { recursive: true });
const out = (name) => join(OUT, name);

const browser = await launch();

async function open({ width = 1280, height = 860, scale = 2, scheme = 'dark', mobile = false, sample = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: scheme, isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (sample) {
    await page.getByRole('button', { name: 'Load sample data' }).click();
    await page.waitForSelector('text=fake sample data');
  }
  return { page, context };
}
// the Cancel? ticks are saved to IndexedDB and then re-rendered, so click and give that a moment
const tick = async (page, name) => { await page.getByLabel(`Cancel ${name}?`).click(); await page.waitForTimeout(300); };
const tab = async (page, name) => { await page.getByRole('tab', { name }).click(); await page.waitForTimeout(1400); };

/** Screenshot the page area from the top of one element to the bottom of another (full-page coordinates). */
async function between(page, file, topSel, bottomSel, pad = 2) {
  const r = await page.evaluate(([t, b]) => {
    const a = document.querySelector(t).getBoundingClientRect(), z = document.querySelector(b).getBoundingClientRect();
    return { x: 0, y: a.top + scrollY, w: document.documentElement.clientWidth, h: z.bottom - a.top };
  }, [topSel, bottomSel]);
  await page.screenshot({ path: out(file), fullPage: true, clip: { x: r.x, y: Math.max(0, r.y - pad), width: r.w, height: r.h + pad * 2 } });
}
/** Scroll an element to the top of the viewport and capture the viewport (phone shots). */
async function viewportAt(page, file, selector, offset = 12) {
  await page.evaluate(([s, o]) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - o), [selector, offset]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: out(file) });
}

// ---------------- desktop, dark
{
  const { page, context } = await open();
  await tab(page, 'Explore');
  await page.evaluate(() => { document.querySelector('.world').style.transform = 'translate3d(0px,0px,0) scale(0.7)'; });
  await page.waitForTimeout(300);
  await between(page, 'explore-board.png', '.view-switch', '.stage');

  await tab(page, 'List');
  await between(page, 'desktop-list.png', '.view-switch', 'article.sub:nth-of-type(3)');

  // select mode: the first cards with the sticky action bar underneath
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  for (const n of ['Netflix', 'Hotstar', 'Spotify']) await page.getByLabel(`Select ${n}`).click();
  await page.evaluate(() => document.getElementById('all-subs-title').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: out('bulk-select.png') });
  await page.keyboard.press('Escape');

  // the price chart for Netflix (two price rises)
  await page.locator('article.sub').filter({ has: page.locator('h3', { hasText: /^Netflix/ }) }).getByRole('button', { name: 'Price history' }).click();
  await page.waitForSelector('[role=dialog] svg.pc');
  await page.locator('[role=dialog]').screenshot({ path: out('price-chart.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  // what is about to be charged in the next 30 days
  await tab(page, 'Next 30 days');
  await page.locator('#view-panel').screenshot({ path: out('digest.png') });
  await tab(page, 'List');

  // the reminder bell on a card, opened (the menu floats above the card, so capture the area around it)
  const spotify = page.locator('article.sub').filter({ has: page.locator('h3', { hasText: /^Spotify/ }) });
  await spotify.locator('.bell-menu summary').click();
  const box = await spotify.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
  await page.screenshot({ path: out('reminder-menu.png'), fullPage: true, clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 230), width: box.width + 16, height: box.height + 250 } });
  await page.keyboard.press('Escape');
  await spotify.locator('.bell-menu summary').click(); // close it again

  await page.locator('[aria-label="Insights"]').screenshot({ path: out('desktop-insights.png') });
  await page.locator('[aria-label="Still being charged"]').screenshot({ path: out('still-charging.png') });

  await page.locator('article.sub', { hasText: 'Netflix' }).getByRole('button', { name: /Cancel/ }).first().click();
  await page.getByRole('button', { name: 'Start cancelling' }).click();
  await page.waitForTimeout(500);
  await page.locator('[role=dialog]').screenshot({ path: out('cancel-kit.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  // the detail view with its price history
  await page.locator('article.sub').filter({ has: page.locator('h3', { hasText: /^Netflix/ }) }).getByRole('button', { name: /Cancel/ }).first().click();
  await page.locator('[role=dialog] details.history summary').click();
  await page.waitForTimeout(300);
  await page.locator('[role=dialog]').screenshot({ path: out('price-history.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  await page.locator('#reminder-settings').scrollIntoViewIfNeeded();
  await page.locator('#reminder-settings').screenshot({ path: out('desktop-reminders.png') });
  await page.locator('#currency-settings').scrollIntoViewIfNeeded();
  await between(page, 'desktop-settings.png', '#currency-settings', '#app-settings');

  await tab(page, 'Yearly');
  for (const name of ['Peloton', 'Dropbox', 'Duolingo']) await tick(page, name);
  await page.waitForTimeout(500);
  await between(page, 'desktop-yearly.png', '.view-switch', '[aria-label="Yearly cost"] article:nth-of-type(4)');

  // a missing exchange rate: left out of totals and called out
  await tab(page, 'List');
  const eur = page.locator('#currency-settings table.rates tr', { hasText: 'EUR' }).locator('input');
  await eur.fill('');
  await eur.press('Enter');
  await page.waitForSelector('[aria-label="Exchange rate needed"]');
  await page.locator('[aria-label="Exchange rate needed"]').screenshot({ path: out('missing-rate.png') });
  await context.close();
}

// ---------------- scan a statement (empty profile, USD base so a dollar statement reads as dollars)
{
  const { page, context } = await open({ width: 900, height: 760, sample: false });
  await page.locator('#currency-settings select').selectOption('USD');
  await page.locator('input[type=file][accept*=csv]').setInputFiles(new URL('../sample-data/us-credit-card.csv', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  await page.waitForSelector('[role=dialog]');
  await page.locator('[role=dialog]').screenshot({ path: out('scan-results.png') });
  await context.close();
}

// ---------------- the review step: a realistic statement with weekly, biweekly, monthly, quarterly and yearly charges
{
  const { page, context } = await open({ width: 1000, height: 1400, sample: false });
  await page.locator('input[type=file][accept*=csv]').setInputFiles(new URL('../sample-data/mixed-cycles.csv', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  await page.waitForSelector('[role=dialog] .pv-row');
  await page.locator('[role=dialog]').screenshot({ path: out('import-preview.png') });
  await context.close();
}

// ---------------- light theme
{
  const { page, context } = await open({ scheme: 'light' });
  await tab(page, 'Yearly');
  for (const name of ['Peloton', 'Dropbox', 'Duolingo']) await tick(page, name);
  await page.waitForTimeout(500);
  await between(page, 'light-theme.png', '.view-switch', '[aria-label="Yearly cost"] article:nth-of-type(4)');
  await context.close();
}

// ---------------- v0.8: restore preview, shortcuts, monthly review
{
  const { page, context } = await open();
  await tab(page, 'List');
  const dlg = page.getByRole('dialog');
  // a small backup with different settings, so the preview has something to compare
  const tmp = mkdtempSync(join(tmpdir(), 'subsweep-shots-'));
  const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const f = join(tmp, 'backup.json');
  writeFileSync(f, JSON.stringify({ app: 'subsweep', version: 2, exportedAt: new Date().toISOString(), dismissedDuplicates: [],
    settings: { baseCurrency: 'USD', reminderDays: [1, 7], rates: { INR: 0.012, EUR: 1.08 } },
    subscriptions: [{ id: 901, name: 'Notion', amount: 10, currency: 'USD', cycle: 'monthly', nextRenewal: day(12), category: 'Software', isTrial: false, notes: 'team plan' },
                    { id: 902, name: 'Strava', amount: 8, currency: 'USD', cycle: 'monthly', nextRenewal: day(5), category: 'Fitness & Health', isTrial: false }] }));
  await page.locator('input[type=file][accept*=json]').setInputFiles(f);
  await dlg.waitFor();
  await page.waitForTimeout(500);
  await dlg.screenshot({ path: out('restore-preview.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  await page.keyboard.press('?');
  await dlg.waitFor();
  await dlg.screenshot({ path: out('shortcuts.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });

  await page.locator('.review-card').scrollIntoViewIfNeeded();
  await page.locator('.review-card').getByRole('button', { name: 'Start review' }).click();
  await dlg.waitFor();
  await dlg.getByRole('button', { name: 'Keep' }).click();
  await page.waitForTimeout(400);
  await dlg.screenshot({ path: out('review.png') });
  await context.close();
}

// ---------------- phone (390 x 844)
{
  const { page, context } = await open({ width: 390, height: 844, scale: 3, mobile: true });
  await viewportAt(page, 'mobile-insights.png', '[aria-label="Insights"]');
  await viewportAt(page, 'mobile-list.png', '.view-switch');
  await tab(page, 'Yearly');
  await tick(page, 'Peloton');
  await viewportAt(page, 'mobile-yearly.png', '.view-switch');
  await tab(page, 'Next 30 days');
  await viewportAt(page, 'mobile-digest.png', '.view-switch');
  await viewportAt(page, 'mobile-settings.png', '#currency-settings');
  await context.close();
}

await browser.close();
console.log('Screenshots written to docs/screenshots');
