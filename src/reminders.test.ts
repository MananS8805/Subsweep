import { describe, it, expect } from 'vitest';
import { getDueReminders, freshReminders, windowFor, silencedReason, normalizeWindows, reminderKey, soonestLabel, whenText, staleKeys, snoozeUntil, notificationText, TRIAL_FLOOR_DAYS } from './reminders';
import { localDate, dayDiff, addDays } from './dates';
import { totals } from './savings';
import type { Subscription } from './types';

let id = 1;
const sub = (o: Partial<Subscription>): Subscription => ({
  id: id++, name: 'Netflix', amount: 649, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-10-20', category: 'Streaming', isTrial: false, ...o,
});
const NOW = '2026-10-16';
const due = (subs: Subscription[], days: number[], now = NOW) => getDueReminders(subs, { reminderDays: days }, now);
const inDays = (n: number, now = NOW) => addDays(now, n);

describe('windowFor', () => {
  it('picks the smallest configured window that still covers the days left', () => {
    const w = [1, 3, 7];
    expect(windowFor(7, w)).toBe(7); expect(windowFor(5, w)).toBe(7); expect(windowFor(4, w)).toBe(7);
    expect(windowFor(3, w)).toBe(3); expect(windowFor(2, w)).toBe(3);
    expect(windowFor(1, w)).toBe(1); expect(windowFor(0, w)).toBe(1);
  });
  it('is null outside every window, for past renewals and for no windows', () => {
    expect(windowFor(8, [1, 3, 7])).toBeNull();
    expect(windowFor(4, [3])).toBeNull();
    expect(windowFor(-1, [1, 3, 7])).toBeNull();
    expect(windowFor(0, [])).toBeNull();
  });
});

describe('getDueReminders: windows 1 / 3 / 7', () => {
  it('window 7 includes anything up to a week out and nothing later', () => {
    const subs = [sub({ name: 'A', nextRenewal: inDays(7) }), sub({ name: 'B', nextRenewal: inDays(8) })];
    expect(due(subs, [7]).map(d => d.sub.name)).toEqual(['A']);
  });
  it('window 3 includes 3 days out but not 4', () => {
    const subs = [sub({ name: 'A', nextRenewal: inDays(3) }), sub({ name: 'B', nextRenewal: inDays(4) })];
    expect(due(subs, [3]).map(d => d.sub.name)).toEqual(['A']);
  });
  it('window 1 means tomorrow and today only', () => {
    const subs = [sub({ name: 'T', nextRenewal: inDays(0) }), sub({ name: 'Tm', nextRenewal: inDays(1) }), sub({ name: 'X', nextRenewal: inDays(2) })];
    expect(due(subs, [1]).map(d => d.sub.name)).toEqual(['T', 'Tm']);
  });
  it('reports which window triggered each one, soonest first', () => {
    const subs = [sub({ name: 'A', nextRenewal: inDays(6) }), sub({ name: 'B', nextRenewal: inDays(2) }), sub({ name: 'C', nextRenewal: inDays(0) })];
    expect(due(subs, [1, 3, 7]).map(d => [d.sub.name, d.daysLeft, d.window])).toEqual([['C', 0, 1], ['B', 2, 3], ['A', 6, 7]]);
  });
  it('a renewal today is due', () => {
    expect(due([sub({ nextRenewal: NOW })], [7])[0].daysLeft).toBe(0);
  });
  it('no windows chosen means no day-before reminders', () => {
    expect(due([sub({ nextRenewal: inDays(1) })], [])).toEqual([]);
  });
  it('ignores past renewals, cancelled subscriptions and subscriptions without an id', () => {
    const subs = [sub({ nextRenewal: inDays(-1) }), sub({ nextRenewal: inDays(1), status: 'cancelled' }), sub({ nextRenewal: inDays(1), status: 'cancelling' }), { ...sub({ nextRenewal: inDays(1) }), id: undefined }];
    expect(due(subs, [7])).toEqual([]);
  });
});

describe('mute and snooze', () => {
  it('a muted subscription gets no reminder', () => {
    expect(due([sub({ nextRenewal: inDays(1), muted: true })], [7])).toEqual([]);
    expect(silencedReason(sub({ muted: true }), NOW)).toBe('muted');
  });
  it('a snooze lasts until its date and then lapses by itself (boundary)', () => {
    const s = (until: string) => sub({ nextRenewal: inDays(2), snoozedUntil: until });
    expect(due([s('2026-10-17')], [7])).toEqual([]);                  // snoozed until tomorrow: silent today
    expect(due([s('2026-10-16')], [7])).toHaveLength(1);              // snooze ends today: back on today
    expect(due([s('2026-10-15')], [7])).toHaveLength(1);              // long expired
    expect(silencedReason(s('2026-10-17'), NOW)).toBe('snoozed');
    expect(silencedReason(s('2026-10-16'), NOW)).toBeNull();
  });
  it('snoozing for N days is N local days from today', () => {
    expect(snoozeUntil('2026-10-16', 1)).toBe('2026-10-17');
    expect(snoozeUntil('2026-10-16', 3)).toBe('2026-10-19');
    expect(snoozeUntil('2026-10-16', 7)).toBe('2026-10-23');
    expect(snoozeUntil('2026-12-30', 3)).toBe('2027-01-02');
  });
  it('muted and snoozed items are left out of reminders but still counted in totals', () => {
    const subs = [sub({ amount: 100, nextRenewal: inDays(1), muted: true }), sub({ amount: 200, nextRenewal: inDays(1), snoozedUntil: '2026-10-30' }), sub({ amount: 300, nextRenewal: inDays(1) })];
    expect(due(subs, [7]).map(d => d.sub.amount)).toEqual([300]);
    expect(totals(subs, 'INR', {}).monthly).toBe(600);
  });
});

describe('free trials', () => {
  const trial = (days: number, o: Partial<Subscription> = {}) => sub({ name: 'Headspace', isTrial: true, nextRenewal: inDays(days), ...o });
  it('always remind about a trial ending within 3 days, whatever windows are chosen', () => {
    expect(due([trial(3)], [1])).toHaveLength(1);
    expect(due([trial(3)], [])).toHaveLength(1);
    expect(due([trial(3)], [1])[0]).toMatchObject({ window: TRIAL_FLOOR_DAYS, trial: true });
    expect(due([trial(2)], [1])[0].window).toBe(3);
  });
  it('a trial further out follows the normal windows', () => {
    expect(due([trial(5)], [1])).toEqual([]);
    expect(due([trial(5)], [7])).toHaveLength(1);
  });
  it('a muted or snoozed trial is still silenced', () => {
    expect(due([trial(1, { muted: true })], [1])).toEqual([]);
    expect(due([trial(1, { snoozedUntil: '2026-10-20' })], [1])).toEqual([]);
  });
});

describe('not showing the same reminder twice', () => {
  it('a reminder already shown for this renewal and window is skipped', () => {
    const s = sub({ nextRenewal: inDays(5) });
    const first = due([s], [3, 7]);
    expect(first[0].key).toBe(reminderKey(s.id!, s.nextRenewal, 7));
    expect(freshReminders(first, [])).toHaveLength(1);
    expect(freshReminders(first, [first[0].key])).toEqual([]);
  });
  it('the tighter window later is a new reminder, and so is the next renewal date', () => {
    const s = sub({ nextRenewal: '2026-10-20' });
    const shown = [due([s], [3, 7], '2026-10-15')[0].key];     // 5 days out: 7-day window shown
    expect(freshReminders(due([s], [3, 7], '2026-10-16'), shown)).toEqual([]);   // 4 days out: still the 7-day window
    expect(freshReminders(due([s], [3, 7], '2026-10-17'), shown)).toHaveLength(1); // 3 days out: the 3-day window is new
    const rolled = { ...s, nextRenewal: '2026-11-20' };
    expect(freshReminders(due([rolled], [3, 7], '2026-11-15'), shown)).toHaveLength(1); // next month's renewal is new
  });
  it('is stable across repeated evaluation on the same day', () => {
    const subs = [sub({ nextRenewal: inDays(2) }), sub({ nextRenewal: inDays(6) })];
    const a = due(subs, [1, 3, 7]).map(d => d.key), b = due(subs, [1, 3, 7]).map(d => d.key);
    expect(a).toEqual(b);
  });
  it('forgets keys for renewals long past', () => {
    expect(staleKeys([{ key: 'a', renewalDate: '2026-08-01', at: '' }, { key: 'b', renewalDate: '2026-10-10', at: '' }, { key: 'c', renewalDate: '2026-09-16', at: '' }], NOW)).toEqual(['a']);
  });
});

describe('dates: local calendar, month and year boundaries', () => {
  it('"today" is the local date, not the UTC date', () => {
    expect(localDate(new Date(2026, 0, 1, 23, 30))).toBe('2026-01-01');   // 11:30pm local on Jan 1, whatever the offset
    expect(localDate(new Date(2026, 11, 31, 0, 5))).toBe('2026-12-31');
  });
  it('counts days across a month end, a year end and a leap day', () => {
    expect(dayDiff('2026-02-27', '2026-03-01')).toBe(2);
    expect(dayDiff('2028-02-27', '2028-03-01')).toBe(3);
    expect(dayDiff('2026-12-30', '2027-01-02')).toBe(3);
    expect(dayDiff('2026-10-16', '2026-10-16')).toBe(0);
    expect(dayDiff('2026-10-16', '2026-10-15')).toBe(-1);
    expect(dayDiff('2026-03-28', '2026-03-30')).toBe(2); // across the EU DST change
  });
  it('reminds across a year boundary and a month boundary', () => {
    expect(due([sub({ nextRenewal: '2027-01-02' })], [3], '2026-12-30')[0].daysLeft).toBe(3);
    expect(due([sub({ nextRenewal: '2026-03-01' })], [3], '2026-02-27')[0].daysLeft).toBe(2);
    expect(due([sub({ nextRenewal: '2028-03-01' })], [3], '2028-02-27')[0].daysLeft).toBe(3);
    expect(due([sub({ nextRenewal: '2027-01-02' })], [1], '2026-12-30')).toEqual([]);
  });
});

describe('settings and text', () => {
  it('only 1, 3 and 7 are valid windows, sorted and unique; empty is allowed', () => {
    expect(normalizeWindows([7, 1, 3, 3])).toEqual([1, 3, 7]);
    expect(normalizeWindows([2, 5, 14, 'x', 7])).toEqual([7]);
    expect(normalizeWindows([])).toEqual([]);
    expect(normalizeWindows('nope')).toEqual([7]);
    expect(normalizeWindows(undefined)).toEqual([7]);
  });
  it('words the soonest renewal', () => {
    expect(whenText(0)).toBe('today'); expect(whenText(1)).toBe('tomorrow'); expect(whenText(4)).toBe('in 4 days');
    expect(soonestLabel([])).toBe('Renewing soon');
    expect(soonestLabel(due([sub({ nextRenewal: inDays(4) }), sub({ nextRenewal: inDays(2) })], [7]))).toBe('Renewing soon · next in 2 days');
    expect(soonestLabel(due([sub({ nextRenewal: NOW })], [7]))).toBe('Renewing soon · next today');
  });
  it('writes the notification', () => {
    const d = due([sub({ name: 'Headspace', isTrial: true, nextRenewal: inDays(1) })], [7])[0];
    expect(notificationText(d, '₹399.00')).toEqual({ title: 'Trial ends tomorrow: Headspace', body: `₹399.00 on ${inDays(1)}` });
  });
});
