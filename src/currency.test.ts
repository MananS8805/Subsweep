import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { convert, formatMoney, detectCurrency, sanitizeRates, isValidRate, CURRENCIES } from './currency';
import { SubDB } from './db';
import { loadSettings } from './settings';
import { parseStatementDetailed, detectRecurring } from './detect';

describe('convert', () => {
  it('returns the amount unchanged for the base currency, ignoring any rate', () => {
    expect(convert(100, 'INR', 'INR', {})).toBe(100);
    expect(convert(100, 'INR', 'INR', { INR: 5 })).toBe(100);
  });
  it('multiplies by the rate (base units per 1 unit of the currency)', () => {
    expect(convert(10, 'USD', 'INR', { USD: 83 })).toBe(830);
    expect(convert(2, 'EUR', 'USD', { EUR: 1.1 })).toBeCloseTo(2.2);
  });
  it('returns null when the rate is missing or invalid, never 1', () => {
    expect(convert(10, 'USD', 'INR', {})).toBeNull();
    expect(convert(10, 'USD', 'INR', { USD: 0 })).toBeNull();
    expect(convert(10, 'USD', 'INR', { USD: -3 })).toBeNull();
    expect(convert(10, 'USD', 'INR', { USD: NaN })).toBeNull();
  });
  it('only accepts positive finite rates', () => {
    expect([1, 0.0001, 83.5].every(isValidRate)).toBe(true);
    expect([0, -1, NaN, Infinity, '83', null].some(isValidRate)).toBe(false);
  });
  it('sanitizes stored rates', () => {
    expect(sanitizeRates({ USD: 83, EUR: 'x', gbp: 100, JPY: -1, CAD: 60 })).toEqual({ USD: 83, CAD: 60 });
    expect(sanitizeRates(null)).toEqual({});
    expect(sanitizeRates([1, 2])).toEqual({});
  });
});

describe('formatMoney', () => {
  it('formats with the right currency', () => {
    expect(formatMoney(1234.5, 'USD')).toMatch(/\$1,234\.50/);
    expect(formatMoney(12.5, 'EUR')).toMatch(/€|EUR/);
    expect(formatMoney(1499, 'INR')).toMatch(/₹|INR/);
  });
  it('does not round before display', () => {
    expect(formatMoney(10.005, 'USD')).toMatch(/10\.0[01]/);
  });
  it('falls back for an unknown code instead of throwing', () => {
    expect(() => formatMoney(5, 'not-a-code')).not.toThrow();
    expect(formatMoney(5, 'not-a-code')).toContain('5.00');
  });
  it('lists around 20 common currencies', () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(20);
    expect(CURRENCIES.map(c => c.code)).toEqual(expect.arrayContaining(['INR', 'USD', 'EUR', 'GBP']));
  });
});

describe('detectCurrency', () => {
  it('reads symbols, abbreviations and ISO codes in an amount', () => {
    expect(detectCurrency('$12.99')).toBe('USD');
    expect(detectCurrency('-$12.99')).toBe('USD');
    expect(detectCurrency('US$ 5')).toBe('USD');
    expect(detectCurrency('€ 12,99')).toBe('EUR');
    expect(detectCurrency('EUR 12,99')).toBe('EUR');
    expect(detectCurrency('£4.99')).toBe('GBP');
    expect(detectCurrency('₹299.00')).toBe('INR');
    expect(detectCurrency('Rs. 299')).toBe('INR');
    expect(detectCurrency('Rs 1,499.00')).toBe('INR');
    expect(detectCurrency('299.00 INR')).toBe('INR');
    expect(detectCurrency('A$9.99')).toBe('AUD');
    expect(detectCurrency('C$9.99')).toBe('CAD');
  });
  it('returns undefined when no currency is shown', () => {
    expect(detectCurrency('12.99')).toBeUndefined();
    expect(detectCurrency('1,499.00 Dr')).toBeUndefined();
    expect(detectCurrency('')).toBeUndefined();
  });
});

describe('currency in statements', () => {
  it('picks the currency up from the amount column and passes it to the detected subscription', () => {
    const csv = ['Date,Description,Amount', ...['2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05'].map(d => `${d},SPOTIFY USA,-$11.99`)].join('\n');
    const { txns } = parseStatementDetailed(csv);
    expect(txns.every(t => t.currency === 'USD')).toBe(true);
    expect(detectRecurring(txns, '2026-09-01')[0].currency).toBe('USD');
  });
  it('uses a Currency column when present, and leaves currency unset when nothing is shown', () => {
    const csv = 'Date,Description,Amount,Currency\n2026-05-05,NETFLIX,-9.99,eur\n2026-06-05,NETFLIX,-9.99,EUR\n';
    expect(parseStatementDetailed(csv).txns.map(t => t.currency)).toEqual(['EUR', 'EUR']);
    const plain = parseStatementDetailed('Date,Description,Amount\n2026-05-05,NETFLIX,-9.99\n').txns[0];
    expect(plain.currency).toBeUndefined();
  });
  it('detects € with comma decimals in a semicolon file', () => {
    const { txns } = parseStatementDetailed('Date;Description;Amount\n15.01.2026;DISNEY PLUS;-€12,99\n15.02.2026;DISNEY PLUS;-€12,99\n');
    expect(txns.map(t => [t.amount, t.currency])).toEqual([[12.99, 'EUR'], [12.99, 'EUR']]);
  });
});

describe('v0.3 -> v0.4 upgrade (multi-currency)', () => {
  it('gives existing rows the base currency, keeps everything else, and sets the default base', async () => {
    const name = 'subsweep-upgrade-test-v4';
    const old = new Dexie(name);
    old.version(3).stores({ subs: '++id, name, nextRenewal', dismissedDuplicates: '++id, &key', settings: 'key' });
    await old.table('subs').bulkAdd([
      { name: 'Netflix', amount: 649, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false, status: 'cancelling', cancelEffectiveDate: '2026-11-03' },
      { name: 'Hulu', amount: 7.99, cycle: 'monthly', nextRenewal: '2026-11-05', category: 'Streaming', isTrial: false, currency: 'USD' },
    ]);
    await old.table('dismissedDuplicates').add({ key: '1-2' });
    old.close();

    const upgraded = new SubDB(name);
    const rows = await upgraded.subs.orderBy('id').toArray();
    expect(rows[0]).toMatchObject({ name: 'Netflix', currency: 'INR', status: 'cancelling', cancelEffectiveDate: '2026-11-03' });
    expect(rows[1].currency).toBe('USD'); // an explicit currency is never overwritten
    expect(await upgraded.dismissedDuplicates.count()).toBe(1);
    expect((await upgraded.settings.get('baseCurrency'))?.value).toBe('INR');
    upgraded.close();
  });
  it('uses an already-chosen base currency for the migration', async () => {
    const name = 'subsweep-upgrade-test-v4b';
    const old = new Dexie(name);
    old.version(3).stores({ subs: '++id, name, nextRenewal', dismissedDuplicates: '++id, &key', settings: 'key' });
    await old.table('settings').put({ key: 'baseCurrency', value: 'EUR' });
    await old.table('subs').add({ name: 'Netflix', amount: 9.99, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false });
    old.close();
    const upgraded = new SubDB(name);
    expect((await upgraded.subs.toArray())[0].currency).toBe('EUR');
    upgraded.close();
  });
});

describe('loadSettings', () => {
  it('falls back to defaults for missing or malformed values', async () => {
    const { db } = await import('./db');
    await db.settings.clear();
    expect(await loadSettings()).toEqual({ baseCurrency: 'INR', rates: {}, ratesNeedReview: false, dismissedInsights: [], sampleIds: [] });
    await db.settings.bulkPut([{ key: 'baseCurrency', value: 'nope' }, { key: 'rates', value: { USD: 83, EUR: 'x' } }, { key: 'dismissedInsights', value: ['a', 3, 'b'] }]);
    expect(await loadSettings()).toMatchObject({ baseCurrency: 'INR', rates: { USD: 83 }, dismissedInsights: ['a', 'b'] });
    await db.settings.clear();
  });
});
