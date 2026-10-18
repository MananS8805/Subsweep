import { describe, it, expect } from 'vitest';
import { getDigest, occurrences, weekStart, digestText, DIGEST_DAYS } from './digest';
import { addDays } from './dates';
import type { Subscription } from './types';

// 2026-10-19 is a Monday. The 30-day window is Oct 19 through Nov 17 inclusive.
const NOW = '2026-10-19';
let id = 1;
const sub = (o: Partial<Subscription>): Subscription => ({
  id: id++, name: 'X', amount: 100, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false, ...o,
});
const S = { baseCurrency: 'INR', rates: { USD: 83 } as Record<string, number> };
const dig = (subs: Subscription[], now = NOW, days = 30) => getDigest(subs, S, now, days);

describe('occurrences per cycle', () => {
  const dates = (o: Partial<Subscription>, now = NOW) => occurrences(sub(o), now, addDays(now, 30));

  it('weekly: 4 or 5 times in 30 days', () => {
    expect(dates({ cycle: 'weekly', nextRenewal: '2026-10-21' })).toEqual(['2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11']);
    expect(dates({ cycle: 'weekly', nextRenewal: '2026-10-19' })).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']); // 5
  });
  it('biweekly: 2 or 3 times', () => {
    expect(dates({ cycle: 'biweekly', nextRenewal: '2026-10-25' })).toEqual(['2026-10-25', '2026-11-08']);
    expect(dates({ cycle: 'biweekly', nextRenewal: '2026-10-19' })).toEqual(['2026-10-19', '2026-11-02', '2026-11-16']);
  });
  it('monthly: once, and a renewal on the last day of the window is outside it', () => {
    expect(dates({ nextRenewal: '2026-10-31' })).toEqual(['2026-10-31']);
    expect(dates({ nextRenewal: '2026-11-17' })).toEqual(['2026-11-17']);
    expect(dates({ nextRenewal: '2026-11-18' })).toEqual([]);   // 30 days from today is excluded
    expect(dates({ nextRenewal: '2026-10-19' })).toEqual(['2026-10-19']);   // today is included
  });
  it('quarterly and yearly count only when they fall inside the window', () => {
    expect(dates({ cycle: 'quarterly', nextRenewal: '2026-11-05' })).toEqual(['2026-11-05']);
    expect(dates({ cycle: 'quarterly', nextRenewal: '2026-12-05' })).toEqual([]);
    expect(dates({ cycle: 'yearly', nextRenewal: '2026-11-10' })).toEqual(['2026-11-10']);
    expect(dates({ cycle: 'yearly', nextRenewal: '2026-12-20' })).toEqual([]);
    expect(dates({ cycle: 'yearly', nextRenewal: '2027-10-19' })).toEqual([]);
  });
  it('month-end renewals keep their day instead of drifting', () => {
    // anchored on the 31st: Jan 31, then Feb 28, then Mar 31 (not Mar 28)
    expect(occurrences(sub({ nextRenewal: '2026-01-31' }), '2026-02-01', '2026-04-05')).toEqual(['2026-02-28', '2026-03-31']);
    expect(occurrences(sub({ nextRenewal: '2026-08-31' }), '2026-10-19', '2026-11-18')).toEqual(['2026-10-31']);
    expect(occurrences(sub({ nextRenewal: '2028-01-31' }), '2028-02-01', '2028-03-02')).toEqual(['2028-02-29']); // leap year
  });
  it('rolls a stale renewal date forward before counting', () => {
    expect(dates({ cycle: 'weekly', nextRenewal: '2026-09-01' }).length).toBeGreaterThanOrEqual(4);
    expect(dates({ nextRenewal: '2026-08-31' })).toEqual(['2026-10-31']);
  });
  it('crosses a year boundary', () => {
    expect(occurrences(sub({ nextRenewal: '2026-12-28' }), '2026-12-20', '2027-01-19')).toEqual(['2026-12-28']);
    expect(occurrences(sub({ cycle: 'weekly', nextRenewal: '2026-12-30' }), '2026-12-20', '2027-01-19')).toEqual(['2026-12-30', '2027-01-06', '2027-01-13']);
    expect(occurrences(sub({ cycle: 'yearly', nextRenewal: '2027-01-02' }), '2026-12-20', '2027-01-19')).toEqual(['2027-01-02']);
  });
  it('a free trial is a single event on its end date', () => {
    expect(dates({ isTrial: true, nextRenewal: '2026-11-01' })).toEqual(['2026-11-01']);
    expect(dates({ isTrial: true, nextRenewal: '2027-01-01' })).toEqual([]);
  });
});

describe('weeks', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekStart('2026-10-19')).toBe('2026-10-19');   // Monday
    expect(weekStart('2026-10-25')).toBe('2026-10-19');   // Sunday
    expect(weekStart('2026-10-26')).toBe('2026-10-26');
    expect(weekStart('2027-01-01')).toBe('2026-12-28');   // across a year end
  });
});

describe('a hand-computed digest', () => {
  // base INR, 1 USD = 83 INR, window Oct 19 - Nov 17
  const subs = () => [
    sub({ name: 'Gym', amount: 100, cycle: 'weekly', nextRenewal: '2026-10-21' }),                 // 21, 28, Nov 4, Nov 11   -> 4 x 100  = 400
    sub({ name: 'Meal kit', amount: 500, cycle: 'biweekly', nextRenewal: '2026-10-25' }),          // 25, Nov 8               -> 2 x 500  = 1000
    sub({ name: 'Netflix', amount: 649, nextRenewal: '2026-10-31' }),                              // Oct 31                  -> 649
    sub({ name: 'Cloud', amount: 100, nextRenewal: '2026-08-31' }),                                // rolls to Oct 31         -> 100
    sub({ name: 'Pest control', amount: 3000, cycle: 'quarterly', nextRenewal: '2026-11-05' }),    // Nov 5                   -> 3000
    sub({ name: 'Domain', amount: 12000, cycle: 'yearly', nextRenewal: '2026-11-10' }),            // Nov 10                  -> 12000
    sub({ name: 'Insurance', amount: 9999, cycle: 'yearly', nextRenewal: '2026-12-20' }),          // outside the window      -> 0
    sub({ name: 'Dropbox', amount: 10, currency: 'USD', nextRenewal: '2026-10-22' }),              // $10 x 83                -> 830
    sub({ name: 'Duolingo', amount: 10, currency: 'EUR', nextRenewal: '2026-10-23' }),             // no EUR rate: listed, not counted
    sub({ name: 'Muted one', amount: 200, nextRenewal: '2026-11-01', muted: true }),               // still costs money      -> 200
    sub({ name: 'Snoozed one', amount: 50, nextRenewal: '2026-11-03', snoozedUntil: '2026-11-30' }),// still costs money     -> 50
    sub({ name: 'Headspace', amount: 399, isTrial: true, nextRenewal: '2026-11-01' }),             // trial: highlighted, not counted
    sub({ name: 'Old gym', amount: 900, status: 'cancelled', nextRenewal: '2026-10-25' }),         // cancelled: ignored
  ];
  const d = dig(subs());
  const byName = (n: string) => subs().find(s => s.name === n);
  void byName;

  it('totals match the hand calculation', () => {
    // 400 + 1000 + 649 + 100 + 3000 + 12000 + 830 + 200 + 50
    expect(d.total).toBe(18229);
    expect(d.payments.reduce((t, p) => t + p.amountBase, 0)).toBe(18229);
    expect(d.payments).toHaveLength(4 + 2 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
  });
  it('covers 30 days from today', () => {
    expect(d).toMatchObject({ from: '2026-10-19', to: '2026-11-17', days: 30 });
    expect(DIGEST_DAYS).toBe(30);
  });
  it('payments are listed in date order', () => {
    const dates = d.payments.map(p => p.date);
    expect(dates).toEqual([...dates].sort());
    expect(d.payments[0].date).toBe('2026-10-21');
  });
  it('groups by calendar week, empty weeks included, with the right totals', () => {
    expect(d.weeks.map(w => w.start)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    // Oct 21 gym + Oct 22 dropbox + Oct 25 meal kit | Oct 28 gym + Oct 31 netflix + Oct 31 cloud + Nov 1 muted
    // | Nov 4 gym + Nov 8 meal kit + Nov 5 pest + Nov 3 snoozed | Nov 10 domain + Nov 11 gym | nothing
    expect(d.weeks.map(w => w.total)).toEqual([100 + 830 + 500, 100 + 649 + 100 + 200, 100 + 500 + 3000 + 50, 12000 + 100, 0]);
    for (const w of d.weeks) expect(w.total).toBe(w.items.reduce((t, p) => t + p.amountBase, 0));
    expect(d.weeks.reduce((t, w) => t + w.total, 0)).toBe(d.total);
  });
  it('puts a Sunday renewal in the week that ends that day', () => {
    const nov1 = d.payments.find(p => p.date === '2026-11-01' && p.amountBase === 200)!;   // Nov 1 2026 is a Sunday
    expect(weekStart(nov1.date)).toBe('2026-10-26');
    expect(d.weeks.find(w => w.start === '2026-10-26')!.items).toContain(nov1);
  });
  it('finds the busiest week', () => {
    expect(d.busiestWeek?.start).toBe('2026-11-09');       // domain 12000 + gym 100
    expect(d.busiestWeek?.total).toBe(12100);
  });
  it('lists the trial separately and keeps it out of the total', () => {
    expect(d.trialsEnding).toEqual([{ subId: expect.any(Number), date: '2026-11-01', daysLeft: 13 }]);
  });
  it('lists a charge with no exchange rate as "rate needed" and does not count it', () => {
    expect(d.rateNeeded).toEqual([{ subId: expect.any(Number), currency: 'EUR' }]);
    expect(d.payments.some(p => p.amountBase === 10 || p.amountBase === 900)).toBe(false);
  });
  it('includes muted and snoozed subscriptions, marked as such', () => {
    const muted = d.payments.find(p => p.amountBase === 200)!, snoozed = d.payments.find(p => p.amountBase === 50)!;
    expect(muted).toMatchObject({ muted: true, snoozed: false });
    expect(snoozed).toMatchObject({ muted: false, snoozed: true });
    expect(d.mutedCount).toBe(2);
  });
  it('ignores cancelled subscriptions', () => {
    expect(d.payments.some(p => p.amountBase === 900)).toBe(false);
  });
  it('converts other currencies with the rate you typed in', () => {
    expect(d.payments.find(p => p.date === '2026-10-22')!.amountBase).toBe(830);
  });
});

describe('edge cases', () => {
  it('an empty list gives an empty digest', () => {
    const d = dig([]);
    expect(d).toMatchObject({ total: 0, payments: [], trialsEnding: [], rateNeeded: [], busiestWeek: null, mutedCount: 0 });
    expect(d.weeks.length).toBeGreaterThan(0);
  });
  it('a subscription with nothing due in the window leaves the digest empty', () => {
    expect(dig([sub({ cycle: 'yearly', nextRenewal: '2027-06-01' })]).payments).toEqual([]);
  });
  it('the number of days is a parameter', () => {
    expect(dig([sub({ nextRenewal: '2026-10-25' })], NOW, 7).payments).toHaveLength(1);
    expect(dig([sub({ nextRenewal: '2026-10-26' })], NOW, 7).payments).toHaveLength(0);   // 7 days from today is excluded
  });
  it('across a year boundary', () => {
    const d = dig([sub({ cycle: 'weekly', amount: 10, nextRenewal: '2026-12-29' })], '2026-12-20');
    expect(d.payments.map(p => p.date)).toEqual(['2026-12-29', '2027-01-05', '2027-01-12']);   // Jan 19 is day 31, outside the window
    expect(d.weeks.map(w => w.start)).toEqual(['2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18']);
    expect(d.total).toBe(30);
  });
  it('uses each subscription\'s own currency, defaulting to the base', () => {
    const d = dig([sub({ amount: 50, currency: undefined, nextRenewal: '2026-10-25' })]);
    expect(d.total).toBe(50);
  });
});

describe('copy summary', () => {
  it('writes plain text with the total, weeks, trials and what was left out', () => {
    const a = sub({ name: 'Gym', amount: 100, cycle: 'weekly', nextRenewal: '2026-10-21' });
    const b = sub({ name: 'Headspace', amount: 399, isTrial: true, nextRenewal: '2026-11-01' });
    const c = sub({ name: 'Duolingo', amount: 10, currency: 'EUR', nextRenewal: '2026-10-23' });
    const m = sub({ name: 'Muted', amount: 200, nextRenewal: '2026-11-02', muted: true });
    const d = dig([a, b, c, m]);
    const names = new Map([a, b, c, m].map(s => [s.id!, s.name]));
    const text = digestText(d, id => names.get(id)!, n => `Rs${n}`);
    expect(text).toContain('SubSweep: next 30 days (2026-10-19 to 2026-11-17)');
    expect(text).toContain('Total due: Rs600 across 5 payments');
    expect(text).toContain('Busiest week: starting 2026-11-02, Rs300');
    expect(text).toContain('2026-10-21  Gym  Rs100');
    expect(text).toContain('Muted  Rs200  (reminders muted)');
    expect(text).toContain('Free trials ending (not in the total):');
    expect(text).toContain('2026-11-01  Headspace');
    expect(text).toContain('exchange rate needed: Duolingo (EUR)');
  });
});
