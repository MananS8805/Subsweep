import { describe, it, expect } from 'vitest';
import { monthlyBase, yearlyCost, totals, categoryYearly, savingsFor, missingCurrencies } from './savings';
import type { Subscription } from './types';

let id = 1;
const sub = (o: Partial<Subscription>): Subscription => ({
  id: id++, name: 'X', amount: 100, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false, ...o,
});
const rates = { USD: 83, EUR: 90 };

// Hand-computed with base INR:
//  Netflix 649 INR/mo            = 649
//  Spotify 10 USD/mo  x 83       = 830
//  Dropbox 120 EUR/yr = 10/mo x 90 = 900
//  Gym 100 INR/week   = 100*52/12 = 433.3333
const set = () => [
  sub({ name: 'Netflix', amount: 649, currency: 'INR', category: 'Streaming' }),
  sub({ name: 'Spotify', amount: 10, currency: 'USD', category: 'Music' }),
  sub({ name: 'Dropbox', amount: 120, currency: 'EUR', cycle: 'yearly', category: 'Cloud & Storage' }),
  sub({ name: 'Gym', amount: 100, currency: 'INR', cycle: 'weekly', category: 'Fitness & Health' }),
];

describe('monthlyBase / yearlyCost', () => {
  it('handles monthly, weekly, quarterly and yearly cycles', () => {
    expect(monthlyBase(sub({ amount: 100, cycle: 'monthly' }), 'INR', {})).toBe(100);
    expect(monthlyBase(sub({ amount: 100, cycle: 'weekly' }), 'INR', {})).toBeCloseTo(433.3333, 3);
    expect(monthlyBase(sub({ amount: 300, cycle: 'quarterly' }), 'INR', {})).toBe(100);
    expect(monthlyBase(sub({ amount: 1200, cycle: 'yearly' }), 'INR', {})).toBe(100);
    expect(yearlyCost(sub({ amount: 100, cycle: 'weekly' }), 'INR', {})).toBeCloseTo(5200, 6);
  });
  it('treats a missing currency as the base and converts others', () => {
    expect(monthlyBase(sub({ amount: 50 }), 'INR', {})).toBe(50);
    expect(monthlyBase(sub({ amount: 10, currency: 'USD' }), 'INR', rates)).toBe(830);
  });
  it('is null without a rate, and a free trial costs nothing even then', () => {
    expect(monthlyBase(sub({ amount: 10, currency: 'USD' }), 'INR', {})).toBeNull();
    expect(yearlyCost(sub({ amount: 10, currency: 'USD' }), 'INR', {})).toBeNull();
    expect(monthlyBase(sub({ amount: 10, currency: 'USD', isTrial: true }), 'INR', {})).toBe(0);
  });
});

describe('totals', () => {
  it('matches the hand-computed example', () => {
    const t = totals(set(), 'INR', rates);
    expect(t.monthly).toBeCloseTo(649 + 830 + 900 + 433.3333, 3);
    expect(t.yearly).toBeCloseTo((649 + 830 + 900 + 433.3333) * 12, 2);
    expect(t.missing).toEqual([]);
  });
  it('excludes items with a missing rate and reports them', () => {
    const t = totals(set(), 'INR', { USD: 83 });
    expect(t.missing.map(s => s.name)).toEqual(['Dropbox']);
    expect(t.monthly).toBeCloseTo(649 + 830 + 433.3333, 3);
    expect(missingCurrencies(set(), 'INR', { USD: 83 })).toEqual(['EUR']);
    expect(missingCurrencies(set(), 'INR', rates)).toEqual([]);
  });
  it('ignores cancelled subscriptions and free trials', () => {
    const s = [...set(), sub({ name: 'Old', amount: 999, status: 'cancelled' }), sub({ name: 'Trial', amount: 999, isTrial: true })];
    expect(totals(s, 'INR', rates).monthly).toBeCloseTo(649 + 830 + 900 + 433.3333, 3);
  });
  it('re-bases when the base currency changes', () => {
    // base USD: rates are USD per 1 unit of each currency
    const t = totals([sub({ amount: 10, currency: 'USD' }), sub({ amount: 830, currency: 'INR' })], 'USD', { INR: 0.012 });
    expect(t.monthly).toBeCloseTo(10 + 9.96, 6);
  });
});

describe('categoryYearly', () => {
  it('sums yearly cost per category in the base currency, largest first', () => {
    const c = categoryYearly(set(), 'INR', rates);
    expect(c[0][0]).toBe('Cloud & Storage'); // 900 * 12 = 10800... vs Music 9960, Streaming 7788
    expect(c.find(([n]) => n === 'Music')![1]).toBe(9960);
    expect(c.find(([n]) => n === 'Streaming')![1]).toBe(7788);
    expect(c.find(([n]) => n === 'Fitness & Health')![1]).toBeCloseTo(5200, 6);
  });
});

describe('savingsFor', () => {
  it('computes monthly, yearly and 5-year savings for a mixed-currency selection', () => {
    const s = set();
    const r = savingsFor(s, [s[1].id!, s[2].id!], 'INR', rates); // Spotify 830 + Dropbox 900
    expect(r.count).toBe(2);
    expect(r.monthly).toBe(1730);
    expect(r.yearly).toBe(20760);
    expect(r.fiveYear).toBe(103800);
    expect(r.missing).toEqual([]);
  });
  it('handles weekly and yearly items', () => {
    const s = set();
    const r = savingsFor(s, [s[3].id!, s[2].id!], 'INR', rates);
    expect(r.yearly).toBeCloseTo(5200 + 10800, 6);
  });
  it('is empty for an empty selection, and ignores unknown ids', () => {
    expect(savingsFor(set(), [], 'INR', rates)).toMatchObject({ count: 0, monthly: 0, yearly: 0, fiveYear: 0 });
    expect(savingsFor(set(), [9999], 'INR', rates).count).toBe(0);
  });
  it('excludes selected items whose rate is missing and reports them', () => {
    const s = set();
    const r = savingsFor(s, [s[0].id!, s[1].id!], 'INR', {});
    expect(r.monthly).toBe(649);
    expect(r.missing.map(x => x.name)).toEqual(['Spotify']);
  });
  it('matches the main total when everything is selected', () => {
    const s = set();
    const all = savingsFor(s, s.map(x => x.id!), 'INR', rates);
    expect(all.monthly).toBeCloseTo(totals(s, 'INR', rates).monthly, 9);
  });
});
