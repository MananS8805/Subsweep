import { describe, it, expect } from 'vitest';
import { addCycle, classify, confidenceLabel, creepFromHistory, detectRecurring, monthlyCost, nextOnOrAfter, parseStatement, priceRuns, scoreConfidence, CYCLE_BANDS } from './detect';
import { addDays } from './dates';
import type { Txn } from './detect';
import type { Cycle } from './types';

// ---- generated fixtures ---------------------------------------------------------------------------------
const tx = (date: string, desc: string, amount: number): Txn => ({ date, desc, amount });
/** `n` charges `gapDays` apart starting at `start`, each at `amount` (or the n-th entry of an array). */
const every = (desc: string, start: string, gapDays: number, n: number, amount: number | number[]): Txn[] =>
  Array.from({ length: n }, (_, i) => tx(addDays(start, i * gapDays), desc, Array.isArray(amount) ? amount[i] : amount));
/** `n` calendar-month charges (month-end aware), like a real monthly bill. */
const monthly = (desc: string, start: string, n: number, amount: number | number[]): Txn[] =>
  Array.from({ length: n }, (_, i) => tx(addCycle(start, 'monthly', i), desc, Array.isArray(amount) ? amount[i] : amount));
const only = (found: ReturnType<typeof detectRecurring>) => { expect(found).toHaveLength(1); return found[0]; };

describe('every cycle is detected', () => {
  it('weekly', () => {
    const d = only(detectRecurring(every('CITY GYM', '2026-08-03', 7, 10, 12), '2026-10-12'));
    expect(d.cycle).toBe('weekly'); expect(confidenceLabel(d.confidence)).toBe('High'); expect(d.occurrences).toBe(10);
  });
  it('biweekly', () => {
    const d = only(detectRecurring(every('MEAL KIT', '2026-06-01', 14, 7, 49.99), '2026-09-01'));
    expect(d.cycle).toBe('biweekly'); expect(confidenceLabel(d.confidence)).toBe('High');
    expect(d.nextRenewal).toBe('2026-09-07');
  });
  it('monthly', () => {
    const d = only(detectRecurring(monthly('SPOTIFY USA', '2026-05-10', 6, 11.99), '2026-10-12'));
    expect(d.cycle).toBe('monthly'); expect(confidenceLabel(d.confidence)).toBe('High'); expect(d.nextRenewal).toBe('2026-11-10');
  });
  it('quarterly', () => {
    const txns = [tx('2025-10-05', 'PEST CONTROL', 60), tx('2026-01-05', 'PEST CONTROL', 60), tx('2026-04-05', 'PEST CONTROL', 60), tx('2026-07-05', 'PEST CONTROL', 60)];
    const d = only(detectRecurring(txns, '2026-10-01'));
    expect(d.cycle).toBe('quarterly'); expect(confidenceLabel(d.confidence)).toBe('High'); expect(d.nextRenewal).toBe('2026-10-05');
  });
  it('yearly seen three times is High, seen twice is capped at Medium', () => {
    const three = only(detectRecurring([tx('2024-03-12', 'DOMAIN RENEWAL', 14.99), tx('2025-03-12', 'DOMAIN RENEWAL', 14.99), tx('2026-03-12', 'DOMAIN RENEWAL', 14.99)], '2026-10-01'));
    expect(three.cycle).toBe('yearly'); expect(confidenceLabel(three.confidence)).toBe('High');
    const two = only(detectRecurring([tx('2025-03-12', 'DOMAIN RENEWAL', 14.99), tx('2026-03-12', 'DOMAIN RENEWAL', 14.99)], '2026-10-01'));
    expect(two.cycle).toBe('yearly'); expect(confidenceLabel(two.confidence)).toBe('Medium'); expect(two.confidence).toBeLessThanOrEqual(0.7);
    expect(two.confidence).toBeLessThan(three.confidence);
  });
  it('two weekly sightings are only Low confidence (could be two coffees a week apart)', () => {
    const d = only(detectRecurring(every('COFFEE BAR', '2026-09-01', 7, 2, 4.5), '2026-09-12'));
    expect(d.cycle).toBe('weekly'); expect(confidenceLabel(d.confidence)).toBe('Low');
  });
});

describe('what must NOT be detected as a subscription', () => {
  it('a single charge is never detected, even a yearly one in a 12-month statement', () => {
    expect(detectRecurring([tx('2026-03-12', 'ANNUAL PLAN', 99)], '2026-10-01')).toEqual([]);
    expect(detectRecurring([tx('2026-01-01', 'ONE OFF SHOP', 20)], '2026-10-01')).toEqual([]);
  });
  it('erratic grocery shopping (irregular gaps, varying amounts) is rejected', () => {
    const days = [0, 3, 9, 12, 20, 23, 31, 36, 44, 47];
    const amounts = [54.2, 23.1, 88, 41.3, 67.9, 19.5, 72.4, 33.8, 58.1, 26.6];
    const groceries = days.map((d, i) => tx(addDays('2026-07-01', d), 'WHOLE FOODS #123', amounts[i]));
    expect(detectRecurring(groceries, '2026-09-01')).toEqual([]);
  });
  it('weekly shopping at the same store with varying amounts is Low, never High or Medium', () => {
    const found = detectRecurring(every('FRESH MARKET', '2026-08-01', 7, 8, [40, 55, 32, 61, 47, 38, 59, 44]), '2026-10-01');
    for (const d of found) { expect(confidenceLabel(d.confidence)).toBe('Low'); expect(d.confidence).toBeLessThanOrEqual(0.45); }
  });
  it('fuel stops (irregular, varying) are rejected', () => {
    const fuel = [tx('2026-06-02', 'SHELL OIL 5744', 41.3), tx('2026-06-19', 'SHELL OIL 5744', 38.75), tx('2026-07-11', 'SHELL OIL 5744', 52.1), tx('2026-07-29', 'SHELL OIL 5744', 36.4)];
    expect(detectRecurring(fuel, '2026-09-01')).toEqual([]);
  });
  it('a plan that changes price by more than 2x is not treated as one subscription', () => {
    expect(detectRecurring(monthly('SOME BILL', '2026-05-01', 5, [10, 10, 10, 35, 35]), '2026-10-01')).toEqual([]);
  });
});

describe('prices and price history', () => {
  it('a mid-series price increase stays one subscription with two price-history entries', () => {
    const txns = monthly('NETFLIX.COM 8665 CA', '2026-05-03', 5, [15.49, 15.49, 15.49, 17.99, 17.99]);
    const d = only(detectRecurring(txns, '2026-10-12'));
    expect(d.priceHistory).toEqual([{ date: '2026-05-03', amount: 15.49 }, { date: '2026-08-03', amount: 17.99 }]);
    expect(d.amount).toBe(17.99);
    expect(d.priceCreep).toEqual({ from: 15.49, to: 17.99 });
    expect(confidenceLabel(d.confidence)).toBe('High');
  });
  it('a steady price has a single history entry and no creep', () => {
    const d = only(detectRecurring(monthly('HULU', '2026-05-09', 4, 7.99), '2026-09-15'));
    expect(d.priceHistory).toEqual([{ date: '2026-05-09', amount: 7.99 }]);
    expect(d.priceCreep).toBeNull();
  });
  it('a price DROP is recorded in the history but is not flagged as creep', () => {
    const d = only(detectRecurring(monthly('HULU', '2026-05-09', 5, [9.99, 9.99, 7.99, 7.99, 7.99]), '2026-10-01'));
    expect(d.priceHistory.map(h => h.amount)).toEqual([9.99, 7.99]);
    expect(d.priceCreep).toBeNull();
  });
  it('tiny wobble (under 5%) is the same price', () => {
    expect(priceRuns([{ date: 'a', amount: 10 }, { date: 'b', amount: 10.3 }, { date: 'c', amount: 9.8 }, { date: 'd', amount: 12 }])).toEqual([{ date: 'a', amount: 10 }, { date: 'd', amount: 12 }]);
  });
  it('creepFromHistory needs a rise of more than 3%', () => {
    expect(creepFromHistory([{ amount: 10 }, { amount: 10.2 }])).toBeNull();
    expect(creepFromHistory([{ amount: 10 }, { amount: 11 }])).toEqual({ from: 10, to: 11 });
    expect(creepFromHistory([{ amount: 10 }])).toBeNull();
  });
});

describe('dates and merchants', () => {
  it('refunds and credits are ignored', () => {
    const csv = ['Date,Description,Amount',
      ...monthly('NETFLIX.COM', '2026-05-03', 5, 15.49).map(t => `${t.date},${t.desc},-${t.amount}`),
      '2026-07-20,NETFLIX REFUND,15.49', '2026-08-20,AMAZON REFUND,29.99'].join('\n');
    const d = only(detectRecurring(parseStatement(csv), '2026-10-12'));
    expect(d.name).toBe('Netflix'); expect(d.occurrences).toBe(5);
  });
  it('month-end drift (31st, 28th, 31st, 30th, 31st) is still monthly', () => {
    const txns = [tx('2026-01-31', 'CLOUD STORE', 9.99), tx('2026-02-28', 'CLOUD STORE', 9.99), tx('2026-03-31', 'CLOUD STORE', 9.99), tx('2026-04-30', 'CLOUD STORE', 9.99), tx('2026-05-31', 'CLOUD STORE', 9.99)];
    const d = only(detectRecurring(txns, '2026-06-10'));
    expect(d.cycle).toBe('monthly'); expect(confidenceLabel(d.confidence)).toBe('High'); expect(d.nextRenewal).toBe('2026-06-30');
  });
  it('a charge posted twice on the same day with the same amount counts once', () => {
    const doubled = monthly('SPOTIFY USA', '2026-05-10', 4, 11.99).flatMap(t => [t, { ...t }]);
    expect(only(detectRecurring(doubled, '2026-09-15')).occurrences).toBe(4);
  });
  it('two different charges from one merchant on the same days become separate series by amount', () => {
    const txns = [...monthly('STREAM CO', '2026-05-05', 4, 9.99), ...monthly('STREAM CO', '2026-05-05', 4, 14.99)];
    const found = detectRecurring(txns, '2026-09-10');
    expect(found).toHaveLength(2);
    expect(found.map(f => f.amount).sort((a, b) => a - b)).toEqual([9.99, 14.99]);
    expect(found.every(f => f.cycle === 'monthly' && f.occurrences === 4)).toBe(true);
  });
  it('picks the currency up from the statement', () => {
    const txns = monthly('DISNEY PLUS', '2026-05-15', 4, 12.99).map(t => ({ ...t, currency: 'EUR' }));
    expect(only(detectRecurring(txns, '2026-09-20')).currency).toBe('EUR');
  });
});

describe('confidence scoring', () => {
  const base = { cycle: 'monthly' as Cycle, occurrences: 4, gaps: [31, 28, 31], priceRunCount: 1, daysSinceLast: 10 };
  it('labels at the documented boundaries', () => {
    expect(confidenceLabel(0.75)).toBe('High'); expect(confidenceLabel(0.7499)).toBe('Medium');
    expect(confidenceLabel(0.5)).toBe('Medium'); expect(confidenceLabel(0.4999)).toBe('Low');
  });
  it('more sightings raise it', () => {
    expect(scoreConfidence({ ...base, occurrences: 6, gaps: [31, 28, 31, 30, 31] })).toBeGreaterThan(scoreConfidence({ ...base, occurrences: 2, gaps: [31] }));
  });
  it('wobbly gaps lower it', () => {
    expect(scoreConfidence({ ...base, gaps: [31, 28, 31] })).toBeGreaterThan(scoreConfidence({ ...base, gaps: [25, 34, 26] }));
  });
  it('a stale series (last charge long ago) scores lower than a fresh one', () => {
    expect(scoreConfidence({ ...base, daysSinceLast: 200 })).toBeLessThan(scoreConfidence({ ...base, daysSinceLast: 10 }));
  });
  it('a clean step to a new price barely matters, erratic prices drag it to Low', () => {
    const stable = scoreConfidence(base);
    const step = scoreConfidence({ ...base, occurrences: 5, gaps: [31, 28, 31, 30], priceRunCount: 2 });
    const erratic = scoreConfidence({ ...base, occurrences: 5, gaps: [31, 28, 31, 30], priceRunCount: 5 });
    expect(step).toBeGreaterThan(0.75); expect(stable).toBeGreaterThan(0.75);
    expect(erratic).toBeLessThanOrEqual(0.45);
  });
  it('always lies between 0 and 1', () => {
    for (const cycle of Object.keys(CYCLE_BANDS) as Cycle[]) for (const n of [2, 3, 8, 30]) for (const days of [0, 400, 5000]) {
      const c = scoreConfidence({ cycle, occurrences: n, gaps: Array(n - 1).fill(10), priceRunCount: 1, daysSinceLast: days });
      expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('cycle math for every cycle', () => {
  it('monthlyCost', () => {
    expect(monthlyCost(100, 'weekly')).toBeCloseTo(433.3333, 3);
    expect(monthlyCost(100, 'biweekly')).toBeCloseTo(216.6667, 3);
    expect(monthlyCost(100, 'monthly')).toBe(100);
    expect(monthlyCost(300, 'quarterly')).toBe(100);
    expect(monthlyCost(1200, 'yearly')).toBe(100);
  });
  it('addCycle', () => {
    expect(addCycle('2026-01-01', 'weekly')).toBe('2026-01-08');
    expect(addCycle('2026-01-01', 'biweekly')).toBe('2026-01-15');
    expect(addCycle('2026-12-25', 'biweekly')).toBe('2027-01-08');
    expect(addCycle('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(addCycle('2026-11-30', 'quarterly')).toBe('2027-02-28');
    expect(addCycle('2028-02-29', 'yearly')).toBe('2029-02-28');
    expect(addCycle('2026-01-01', 'biweekly', 3)).toBe('2026-02-12');
  });
  it('nextOnOrAfter rolls every cycle forward to today or later', () => {
    expect(nextOnOrAfter('2026-01-01', 'biweekly', '2026-02-01')).toBe('2026-02-12');
    expect(nextOnOrAfter('2026-01-01', 'weekly', '2026-01-01')).toBe('2026-01-01');
    expect(nextOnOrAfter('2026-01-01', 'quarterly', '2026-10-01')).toBe('2026-10-01');
  });
  it('the cycle bands do not overlap and classify() agrees with them', () => {
    const bands = Object.entries(CYCLE_BANDS).sort((a, b) => a[1][0] - b[1][0]);
    for (let i = 1; i < bands.length; i++) expect(bands[i][1][0]).toBeGreaterThan(bands[i - 1][1][1]);
    expect(classify(7)).toBe('weekly'); expect(classify(14)).toBe('biweekly'); expect(classify(30)).toBe('monthly');
    expect(classify(91)).toBe('quarterly'); expect(classify(365)).toBe('yearly'); expect(classify(50)).toBeNull(); expect(classify(1)).toBeNull();
  });
});
