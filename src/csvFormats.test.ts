import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStatement, parseStatementDetailed, detectRecurring } from './detect';
import { parseAmount, parseDate, inferDateOrder } from './csvFormats';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const TODAY = '2026-05-01';
const detect = (name: string) => detectRecurring(parseStatement(fixture(name)), TODAY);

describe('CSV fixtures detect a known monthly charge', () => {
  it('US signed amount, MM/DD/YYYY, ignores refund and payroll', () => {
    const d = detect('us-signed.csv');
    expect(d.map(x => x.name)).toEqual(['Netflix']);
    expect(d[0]).toMatchObject({ cycle: 'monthly', amount: 15.49, nextRenewal: '2026-05-15' });
  });
  it('separate Debit/Credit columns', () => {
    const d = detect('debit-credit.csv');
    expect(d.map(x => x.name)).toEqual(['Spotify']);
    expect(d[0]).toMatchObject({ cycle: 'monthly', amount: 11.99, nextRenewal: '2026-05-05' });
  });
  it('Indian style DD/MM/YYYY with Dr/Cr and thousands separators', () => {
    const d = detect('indian-drcr.csv');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ cycle: 'monthly', amount: 1299, nextRenewal: '2026-05-05' });
    expect(d[0].name).toBe('Hotstar');
  });
  it('European semicolon with comma decimals', () => {
    const d = detect('european-semicolon.csv');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ name: 'Disney', cycle: 'monthly', amount: 12.99, nextRenewal: '2026-05-15' });
  });
  it('UTF-8 BOM', () => {
    expect(fixture('bom.csv').charCodeAt(0)).toBe(0xfeff);
    const d = detect('bom.csv');
    expect(d.map(x => x.name)).toEqual(['Hulu']);
    expect(d[0].amount).toBe(7.99);
  });
  it('junk header and footer lines; counts the unparseable row', () => {
    const r = parseStatementDetailed(fixture('junk-header.csv'));
    expect(r.skippedRows).toBe(1);
    const d = detectRecurring(r.txns, TODAY);
    expect(d.map(x => x.name)).toEqual(['Dropbox']);
    expect(d[0].amount).toBe(11.99);
  });
  it('tab-delimited, DD MMM YYYY, Withdrawal/Deposit and currency symbols', () => {
    const d = detect('tab-dmmmy.tsv');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ name: 'Adobe', cycle: 'monthly', amount: 54.99, nextRenewal: '2026-05-05' });
  });
});

describe('statement edge cases', () => {
  it('never treats credits or refunds as candidates', () => {
    const t = parseStatement(fixture('debit-credit.csv'));
    expect(t.some(x => /refund|salary/i.test(x.desc))).toBe(false);
  });
  it('throws a clear error when no date/amount columns exist', () => {
    expect(() => parseStatement('foo,bar\n1,2\n')).toThrow(/Could not find date, description and amount columns/);
  });
  it('reports zero skipped rows for clean files', () => {
    expect(parseStatementDetailed(fixture('us-signed.csv')).skippedRows).toBe(0);
  });
});

describe('date and amount parsing', () => {
  it('parses all supported date formats', () => {
    expect(parseDate('2026-03-05')).toBe('2026-03-05');
    expect(parseDate('25/03/2026')).toBe('2026-03-25');
    expect(parseDate('03/25/2026')).toBe('2026-03-25');
    expect(parseDate('25-03-2026')).toBe('2026-03-25');
    expect(parseDate('25 Mar 2026')).toBe('2026-03-25');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('hello')).toBeNull();
  });
  it('infers order from the whole file, defaulting to day-first', () => {
    expect(inferDateOrder(['03/04/2026', '05/06/2026'])).toBe('dmy');
    expect(inferDateOrder(['03/04/2026', '05/16/2026'])).toBe('mdy');
    expect(inferDateOrder(['03/04/2026', '16/05/2026'])).toBe('dmy');
    expect(parseDate('03/04/2026', 'mdy')).toBe('2026-03-04');
    expect(parseDate('03/04/2026', 'dmy')).toBe('2026-04-03');
  });
  it('parses amount styles', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('12,99')).toBe(12.99);
    expect(parseAmount('(15.49)')).toBe(-15.49);
    expect(parseAmount('$-15.49')).toBe(-15.49);
    expect(parseAmount('15.49-')).toBe(-15.49);
    expect(parseAmount('£1,299.00 Dr')).toBe(-1299);
    expect(parseAmount('1,299.00 Cr')).toBe(1299);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});
