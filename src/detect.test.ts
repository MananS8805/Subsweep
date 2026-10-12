import { describe, it, expect } from 'vitest';
import { parseStatement, detectRecurring, addCycle, normalizeMerchant } from './detect';
import { buildIcs } from './ics';

const csv = `Date,Description,Amount
2026-05-03,NETFLIX.COM 8665 CA,-15.49
2026-06-03,NETFLIX.COM 8665 CA,-15.49
2026-07-03,NETFLIX.COM 8665 CA,-15.49
2026-08-03,NETFLIX.COM 8665 CA,-17.99
2026-09-03,NETFLIX.COM 8665 CA,-17.99
2026-05-10,SPOTIFY USA,-11.99
2026-06-10,SPOTIFY USA,-11.99
2026-07-10,SPOTIFY USA,-11.99
2026-08-10,SPOTIFY USA,-11.99
2026-09-10,SPOTIFY USA,-11.99
2026-05-12,WHOLE FOODS #123,-54.20
2026-06-02,WHOLE FOODS #456,-23.10
2026-07-19,WHOLE FOODS #789,-88.00
2026-01-15,ADOBE *CREATIVE CLOUD,-659.88
2026-09-01,PAYROLL ACME,2500.00
`;
describe('detection', () => {
  const txns = parseStatement(csv);
  it('parses debits only', () => { expect(txns.length).toBe(14); });
  it('finds monthly subs, ignores groceries', () => {
    const d = detectRecurring(txns, '2026-10-12');
    const names = d.map(x => x.name);
    expect(names).toContain('Netflix'); expect(names).toContain('Spotify');
    expect(names.some(n => n.includes('Whole'))).toBe(false);
  });
  it('flags price creep and next renewal', () => {
    const n = detectRecurring(txns, '2026-10-12').find(x => x.name === 'Netflix')!;
    expect(n.cycle).toBe('monthly'); expect(n.priceCreep).toEqual({ from: 15.49, to: 17.99 });
    expect(n.nextRenewal).toBe('2026-11-03');
  });
  it('handles month-end rollover', () => { expect(addCycle('2026-01-31', 'monthly')).toBe('2026-02-28'); });
  it('normalizes merchants', () => { expect(normalizeMerchant('NETFLIX.COM 8665 CA')).toBe('netflix'); });
  it('handles separate debit column CSVs', () => {
    const t = parseStatement('Date,Description,Debit,Credit\n03/01/2026,Hulu,7.99,\n04/01/2026,Hulu,7.99,\n05/01/2026,Hulu,7.99,\n');
    expect(detectRecurring(t, '2026-10-12')[0].name).toBe('Hulu');
  });
  it('builds ics', () => {
    const ics = buildIcs([{ id: 1, name: 'Hulu', amount: 7.99, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Streaming', isTrial: false }]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261101'); expect(ics).toContain('DTEND;VALUE=DATE:20261102'); expect(ics).toContain('RRULE:FREQ=MONTHLY');
  });
});
