import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { canonicalLabel, labelKey, listMethods, looksLikeCardNumber, matchesMethod, normalizeLabel, totalsByMethod, validateLabel } from './paymentMethods';
import { applyBulk, doneMessage, planUndo } from './bulk';
import { runBulk, runUndo } from './bulkDb';
import { db } from './db';
import { exportBackup, importBackup, parseBackup } from './backup';
import { validateSubscription } from './validate';
import { mergeSubscriptions } from './dedupe';
import type { Subscription } from './types';

const sub = (o: Partial<Subscription>): Subscription => ({ id: 1, name: 'A', amount: 10, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false, currency: 'USD', ...o });

describe('normalizeLabel', () => {
  it('trims, collapses spaces and caps at 40', () => {
    expect(normalizeLabel('  Visa   4242 ')).toBe('Visa 4242');
    expect(normalizeLabel('x'.repeat(60))).toHaveLength(40);
    expect(normalizeLabel(undefined)).toBe('');
    expect(normalizeLabel(5)).toBe('');
  });
  it('treats labels that differ only in case or spacing as the same', () => {
    expect(labelKey('Visa 4242')).toBe(labelKey('visa 4242 '));
    expect(labelKey('Visa  4242')).toBe(labelKey('visa 4242'));
  });
  it('reuses the first-seen casing', () => {
    expect(canonicalLabel('visa 4242 ', [sub({ paymentMethod: 'Visa 4242' })])).toBe('Visa 4242');
    expect(canonicalLabel('Amex gold', [sub({ paymentMethod: 'Visa 4242' })])).toBe('Amex gold');
  });
});

describe('card numbers are refused', () => {
  it('detects 13 to 19 digits with spaces or dashes', () => {
    expect(looksLikeCardNumber('4242424242424242')).toBe(true);
    expect(looksLikeCardNumber('4242 4242 4242 4242')).toBe(true);
    expect(looksLikeCardNumber('4242-4242-4242-4242')).toBe(true);
    expect(looksLikeCardNumber('4111111111111')).toBe(true);
    expect(looksLikeCardNumber('Visa ending 4242')).toBe(false);
    expect(looksLikeCardNumber('4242')).toBe(false);
    expect(looksLikeCardNumber('12 digits 1234')).toBe(false);
  });
  it('gives a message with the nickname hint, and the shared validator blocks saving', () => {
    expect(validateLabel('4242 4242 4242 4242')).toMatch(/nickname like Visa ending 4242/);
    expect(validateLabel('Visa ending 4242')).toBeNull();
    expect(validateLabel('')).toBeNull();
    expect(validateLabel('y'.repeat(41))).toMatch(/at most 40/);
    expect(validateSubscription(sub({ paymentMethod: '4242424242424242' }))).toMatch(/card number/);
    expect(validateSubscription(sub({ paymentMethod: 'Visa 4242' }))).toBeNull();
  });
  it('a backup never stores a card-number label', () => {
    const text = JSON.stringify({ app: 'subsweep', version: 2, subscriptions: [{ ...sub({}), paymentMethod: '4242 4242 4242 4242' }] });
    expect(parseBackup(text).subscriptions[0].paymentMethod).toBeUndefined();
  });
});

describe('listMethods', () => {
  it('orders by use then name, merging case variants under the first spelling', () => {
    const subs = [sub({ id: 1, paymentMethod: 'Visa 4242' }), sub({ id: 2, paymentMethod: 'visa 4242 ' }), sub({ id: 3, paymentMethod: 'Amex' }), sub({ id: 4, paymentMethod: 'Cash' }), sub({ id: 5 }), sub({ id: 6, paymentMethod: 'cash' }), sub({ id: 7, paymentMethod: 'Cash' })];
    expect(listMethods(subs)).toEqual([{ label: 'Cash', count: 3 }, { label: 'Visa 4242', count: 2 }, { label: 'Amex', count: 1 }]);
  });
  it('filters: all, none, or a label ignoring case', () => {
    const a = sub({ paymentMethod: 'Visa 4242' }), b = sub({});
    expect(matchesMethod(a, 'all') && matchesMethod(b, 'all')).toBe(true);
    expect(matchesMethod(a, 'none')).toBe(false);
    expect(matchesMethod(b, 'none')).toBe(true);
    expect(matchesMethod(a, 'visa 4242')).toBe(true);
    expect(matchesMethod(b, 'visa 4242')).toBe(false);
  });
});

describe('totalsByMethod', () => {
  const settings = { baseCurrency: 'INR', rates: { USD: 80 } };
  it('sums monthly base cost per label, counts missing-rate items separately and puts unlabelled last', () => {
    const subs = [
      sub({ id: 1, paymentMethod: 'Visa', amount: 10, currency: 'USD' }),                      // 800
      sub({ id: 2, paymentMethod: 'visa', amount: 120, currency: 'USD', cycle: 'yearly' }),    // 10 * 80 = 800
      sub({ id: 3, paymentMethod: 'Visa', amount: 5, currency: 'EUR' }),                       // no rate
      sub({ id: 4, paymentMethod: 'UPI', amount: 2000, currency: 'INR' }),                     // 2000
      sub({ id: 5, amount: 100, currency: 'INR' }),                                            // no label
      sub({ id: 6, paymentMethod: 'Visa', amount: 99, currency: 'USD', status: 'cancelled' }), // not live
      sub({ id: 7, paymentMethod: 'UPI', amount: 50, currency: 'INR', isTrial: true }),        // trial costs 0
    ];
    const rows = totalsByMethod(subs, settings);
    expect(rows.map(r => r.label)).toEqual(['UPI', 'Visa', null]);
    expect(rows[0]).toMatchObject({ count: 2, monthly: 2000, rateNeeded: 0 });
    expect(rows[1]).toMatchObject({ count: 3, monthly: 1600, rateNeeded: 1 });
    expect(rows[2]).toMatchObject({ count: 1, monthly: 100 });
  });
});

describe('bulk set payment method with undo', () => {
  it('sets, reports and undoes exactly, removing a field that did not exist', () => {
    const subs = [sub({ id: 1 }), sub({ id: 2, paymentMethod: 'Cash' }), sub({ id: 3, paymentMethod: 'Visa' })];
    const plan = applyBulk(subs, [1, 2, 3], { type: 'paymentMethod', label: 'Visa' });
    expect(plan.changed).toBe(2); // #3 already had it
    expect(doneMessage({ type: 'paymentMethod', label: 'Visa' }, 2)).toBe('Set payment method to Visa for 2 subscriptions.');
    const after = subs.map(s => { const p = plan.patches.find(x => x.id === s.id); return p ? { ...s, ...p.patch } : s; });
    const undo = planUndo(after, plan.undo);
    expect(undo.restored).toBe(2);
    expect(undo.restores.find(r => r.id === 1)!.patch).toEqual({ paymentMethod: undefined });
    expect(undo.restores.find(r => r.id === 2)!.patch).toEqual({ paymentMethod: 'Cash' });
  });
});

describe('merge keeps a non-empty label', () => {
  it('prefers one that is set', () => {
    const { keep } = mergeSubscriptions([sub({ id: 1, createdAt: '2026-01-01T00:00:00Z' }), sub({ id: 2, paymentMethod: 'Visa 4242', createdAt: '2026-02-01T00:00:00Z' })]);
    expect(keep.paymentMethod).toBe('Visa 4242');
  });
});

describe('database and backup', () => {
  beforeEach(async () => { await Promise.all([db.subs.clear(), db.dismissedDuplicates.clear(), db.settings.clear()]); });
  it('bulk set and undo through the database', async () => {
    await db.subs.bulkAdd([sub({ id: 1 }), sub({ id: 2, paymentMethod: 'Cash' })]);
    const all = await db.subs.toArray();
    const plan = await runBulk(all, [1, 2], { type: 'paymentMethod', label: 'Visa' });
    expect((await db.subs.toArray()).every(s => s.paymentMethod === 'Visa')).toBe(true);
    await runUndo(plan.undo);
    const back = await db.subs.orderBy('id').toArray();
    expect(back[0].paymentMethod).toBeUndefined();
    expect(back[1].paymentMethod).toBe('Cash');
  });
  it('round-trips through a backup, and old backups without the field import cleanly', async () => {
    await db.subs.bulkAdd([sub({ id: 1, paymentMethod: 'Visa 4242' }), sub({ id: 2 })]);
    const text = JSON.stringify(await exportBackup());
    await db.subs.clear();
    await importBackup(text, 'replace');
    const rows = await db.subs.orderBy('id').toArray();
    expect(rows[0].paymentMethod).toBe('Visa 4242');
    expect('paymentMethod' in rows[1]).toBe(false);
    const old = JSON.stringify({ app: 'subsweep', version: 1, subscriptions: [{ id: 9, name: 'Old', amount: 1, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false }] });
    expect((await importBackup(old, 'merge')).added).toBe(1);
  });
});
