import { describe, it, expect } from 'vitest';
import Papa from 'papaparse';
import { BOM, csvFileName, digestToCsv, hasDataRows, moneyCell, subscriptionsToCsv, SUBSCRIPTION_COLUMNS, textCell } from './exportCsv';
import { getDigest } from './digest';
import type { Subscription } from './types';

const sub = (o: Partial<Subscription>): Subscription => ({ id: 1, name: 'A', amount: 10, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false, currency: 'USD', ...o });
const settings = { baseCurrency: 'INR', rates: { USD: 80 } };
const parse = (csv: string) => Papa.parse<Record<string, string>>(csv.replace(BOM, ''), { header: true, skipEmptyLines: true }).data;

describe('cells', () => {
  it('quotes commas, quotes and newlines per RFC 4180', () => {
    expect(textCell('a,b')).toBe('"a,b"');
    expect(textCell('say "hi"')).toBe('"say ""hi"""');
    expect(textCell('two\nlines')).toBe('"two\nlines"');
    expect(textCell('plain')).toBe('plain');
  });
  it('neutralises formula starters in text cells only', () => {
    for (const c of ['=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\rx']) expect(textCell(c).replace(/^"/, '')[0]).toBe("'");
    expect(textCell('=1+1,2')).toBe(`"'=1+1,2"`);
    expect(moneyCell(-5)).toBe('-5.00');
    expect(moneyCell(12.3456)).toBe('12.35');
    expect(moneyCell(null)).toBe('');
  });
});

describe('subscriptionsToCsv', () => {
  it('starts with a BOM and the documented header, and parses back with PapaParse', () => {
    const csv = subscriptionsToCsv([sub({ name: 'Café, "Plus"', notes: 'line1\nline2', paymentMethod: 'Visa 4242', muted: true, selectedForCancel: true, lastReviewedAt: '2026-10-01' })], settings);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv.replace(BOM, '').split('\r\n')[0]).toBe(SUBSCRIPTION_COLUMNS.join(','));
    const [row] = parse(csv);
    expect(row).toMatchObject({ name: 'Café, "Plus"', notes: 'line1\nline2', payment_method: 'Visa 4242', muted: 'yes', cancel_flag: 'yes', trial: 'no', last_reviewed: '2026-10-01', amount: '10.00', currency: 'USD', cycle: 'monthly', next_renewal: '2026-11-01', monthly_base: '800.00', yearly_base: '9600.00', base_currency: 'INR' });
  });
  it('neutralises a name that starts with =', () => {
    expect(parse(subscriptionsToCsv([sub({ name: '=HYPERLINK("x")' })], settings))[0].name).toBe(`'=HYPERLINK("x")`);
  });
  it('leaves monthly_base empty (not 0) when there is no rate', () => {
    const [row] = parse(subscriptionsToCsv([sub({ currency: 'EUR' })], settings));
    expect(row.monthly_base).toBe('');
    expect(row.yearly_base).toBe('');
  });
  it('an empty list is header only, and sample rows are never exported', () => {
    expect(hasDataRows(subscriptionsToCsv([], settings))).toBe(false);
    expect(hasDataRows(subscriptionsToCsv([sub({ importBatchId: 'sample-data' })], settings))).toBe(false);
    expect(hasDataRows(subscriptionsToCsv([sub({})], settings))).toBe(true);
  });
});

describe('digestToCsv', () => {
  it('has one row per payment, then trials and rate-needed rows', () => {
    const subs = [
      sub({ id: 1, name: 'Gym', cycle: 'weekly', nextRenewal: '2026-10-22', amount: 5 }),
      sub({ id: 2, name: 'Muted', nextRenewal: '2026-10-25', muted: true }),
      sub({ id: 3, name: 'Trial', isTrial: true, nextRenewal: '2026-10-28' }),
      sub({ id: 4, name: 'Euro', currency: 'EUR', nextRenewal: '2026-10-30' }),
    ];
    const d = getDigest(subs, settings, '2026-10-20');
    const rows = parse(digestToCsv(d, subs, 'INR'));
    expect(rows.filter(r => r.status === 'normal' || r.status === 'muted')).toHaveLength(d.payments.length);
    expect(rows.find(r => r.name === 'Muted')!.status).toBe('muted');
    expect(rows.find(r => r.name === 'Trial')!.status).toBe('trial');
    const euro = rows.find(r => r.name === 'Euro')!;
    expect(euro.status).toBe('rate_needed');
    expect(euro.amount_base).toBe('');
    expect(rows[0].week_start).toBe('2026-10-19');
    expect(digestToCsv(d, subs, 'INR').startsWith(BOM)).toBe(true);
  });
  it('is header only for nothing due', () => {
    expect(hasDataRows(digestToCsv(getDigest([], settings, '2026-10-20'), [], 'INR'))).toBe(false);
  });
});

describe('csvFileName', () => {
  it('uses the supplied local date', () => {
    expect(csvFileName('subscriptions', '2026-10-20')).toBe('subsweep-subscriptions-2026-10-20.csv');
    expect(csvFileName('next30', '2026-10-20')).toBe('subsweep-next30-2026-10-20.csv');
  });
});
