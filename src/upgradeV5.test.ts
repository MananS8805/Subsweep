import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { SubDB, db } from './db';
import { exportBackup, importBackup, parseBackup } from './backup';
import { loadSettings } from './settings';
import { localDate } from './dates';
import type { Subscription } from './types';

describe('v0.5 (Dexie v4) -> v0.6 (Dexie v5) upgrade', () => {
  it('keeps every row, builds a one-entry price history, and adds the reminders table', async () => {
    const name = 'subsweep-upgrade-test-v5';
    const old = new Dexie(name);
    old.version(4).stores({ subs: '++id, name, nextRenewal', dismissedDuplicates: '++id, &key', settings: 'key' });
    await old.table('subs').bulkAdd([
      { name: 'Netflix', amount: 649, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false, createdAt: '2026-02-10T08:00:00.000Z', priceCreep: { from: 499, to: 649 }, status: 'cancelling', cancelEffectiveDate: '2026-11-03' },
      { name: 'Hulu', amount: 7.99, currency: 'USD', cycle: 'weekly', nextRenewal: '2026-11-05', category: 'Streaming', isTrial: false },
      { name: 'Spotify', amount: 119, currency: 'INR', cycle: 'monthly', nextRenewal: '2026-11-07', category: 'Music', isTrial: false, priceHistory: [{ date: '2026-01-01', amount: 99 }, { date: '2026-06-01', amount: 119 }] },
    ]);
    await old.table('settings').bulkPut([{ key: 'baseCurrency', value: 'INR' }, { key: 'rates', value: { USD: 83 } }]);
    await old.table('dismissedDuplicates').add({ key: '1-2' });
    old.close();

    const upgraded = new SubDB(name);
    const rows = await upgraded.subs.orderBy('id').toArray();
    expect(rows).toHaveLength(3);
    // existing data is untouched
    expect(rows[0]).toMatchObject({ name: 'Netflix', amount: 649, status: 'cancelling', cancelEffectiveDate: '2026-11-03', priceCreep: { from: 499, to: 649 } });
    // history built from the current price: dated by createdAt when known, otherwise today (local)
    expect(rows[0].priceHistory).toEqual([{ date: '2026-02-10', amount: 649 }]);
    expect(rows[1].priceHistory).toEqual([{ date: localDate(), amount: 7.99 }]);
    // an existing history is left exactly as it was
    expect(rows[2].priceHistory).toEqual([{ date: '2026-01-01', amount: 99 }, { date: '2026-06-01', amount: 119 }]);
    expect(await upgraded.dismissedDuplicates.count()).toBe(1);
    expect((await upgraded.settings.get('rates'))?.value).toEqual({ USD: 83 });
    // the new table works
    await upgraded.notifiedReminders.put({ key: '1|2026-11-03|3', renewalDate: '2026-11-03', at: new Date().toISOString() });
    expect(await upgraded.notifiedReminders.count()).toBe(1);
    upgraded.close();
  });
});

describe('backup with the new fields', () => {
  beforeEach(async () => { await Promise.all([db.subs.clear(), db.settings.clear(), db.dismissedDuplicates.clear()]); });
  const rich: Subscription = {
    id: 30, name: 'Netflix', amount: 649, currency: 'INR', cycle: 'biweekly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false,
    priceHistory: [{ date: '2026-05-03', amount: 499 }, { date: '2026-08-03', amount: 649 }], priceCreep: { from: 499, to: 649 },
    confidence: 0.87, importBatchId: 'import-abc', muted: true, snoozedUntil: '2026-10-20',
  };

  it('round-trips priceHistory, biweekly, confidence, mute, snooze and the reminder settings', async () => {
    await db.subs.add(rich);
    await db.settings.bulkPut([{ key: 'reminderDays', value: [1, 7] }, { key: 'baseCurrency', value: 'INR' }]);
    const text = JSON.stringify(await exportBackup());
    await Promise.all([db.subs.clear(), db.settings.clear()]);
    await importBackup(text, 'merge');
    expect(await db.subs.get(30)).toEqual(rich);
    expect((await loadSettings()).reminderDays).toEqual([1, 7]);
  });
  it('still restores a backup made before these fields existed', async () => {
    const old = { app: 'subsweep', version: 2, subscriptions: [{ id: 1, name: 'Hulu', amount: 7.99, cycle: 'monthly', nextRenewal: '2026-11-05', category: 'Streaming', isTrial: false, currency: 'USD' }], dismissedDuplicates: [], settings: { baseCurrency: 'INR', rates: { USD: 83 } } };
    await importBackup(JSON.stringify(old), 'replace');
    const row = await db.subs.get(1);
    expect(row?.name).toBe('Hulu');
    expect(row?.muted).toBeUndefined(); expect(row?.priceHistory).toBeUndefined();
    expect((await loadSettings()).reminderDays).toEqual([7]); // default when the file has none
  });
  it('rejects malformed new fields and leaves data alone', async () => {
    const mk = (extra: object) => JSON.stringify({ app: 'subsweep', version: 2, subscriptions: [{ name: 'X', amount: 1, cycle: 'monthly', nextRenewal: '2026-11-05', category: 'Other', isTrial: false, ...extra }] });
    expect(() => parseBackup(mk({ muted: 'yes' }))).toThrow(/"muted"/);
    expect(() => parseBackup(mk({ snoozedUntil: 'tomorrow' }))).toThrow(/"snoozedUntil"/);
    expect(() => parseBackup(mk({ confidence: 1.4 }))).toThrow(/"confidence"/);
    expect(() => parseBackup(mk({ importBatchId: 7 }))).toThrow(/"importBatchId"/);
    expect(() => parseBackup(mk({ cycle: 'fortnightly' }))).toThrow(/"cycle"/);
    expect(() => parseBackup(mk({ cycle: 'biweekly' }))).not.toThrow();
  });
  it('tolerates a hand-edited reminderDays setting', async () => {
    await db.settings.put({ key: 'reminderDays', value: [2, 7, 99, 'x', 1] });
    expect((await loadSettings()).reminderDays).toEqual([1, 7]);
    await db.settings.put({ key: 'reminderDays', value: 'garbage' });
    expect((await loadSettings()).reminderDays).toEqual([7]);
    await db.settings.put({ key: 'reminderDays', value: [] });
    expect((await loadSettings()).reminderDays).toEqual([]); // "no day-before reminders" is a real choice
  });
});
