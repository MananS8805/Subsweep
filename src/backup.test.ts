import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { exportBackup, importBackup, parseBackup, previewBackup, backupFileName, BackupError } from './backup';
import type { Subscription } from './types';

const seed: Subscription[] = [
  { id: 1, name: 'Netflix', amount: 15.49, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false, priceCreep: { from: 13.99, to: 15.49 }, createdAt: '2026-01-02T10:20:30.456Z', priceHistory: [{ date: '2026-01-02', amount: 13.99 }] },
  { id: 2, name: 'Hulu', amount: 0.99, cycle: 'weekly', nextRenewal: '2026-10-20', category: 'Streaming', isTrial: true, notes: 'cancel before it converts' },
  { id: 5, name: 'Dropbox', amount: 119.88, cycle: 'yearly', nextRenewal: '2027-03-01', category: 'Cloud & Storage', isTrial: false, priceCreep: null },
];
const snapshot = async () => ({
  subs: await db.subs.orderBy('id').toArray(),
  dismissed: (await db.dismissedDuplicates.toArray()).map(d => d.key).sort(),
  settings: await db.settings.toArray(),
});
const wipe = () => Promise.all([db.subs.clear(), db.dismissedDuplicates.clear(), db.settings.clear()]);
const seedDb = async () => {
  await db.subs.bulkAdd(seed);
  await db.dismissedDuplicates.bulkAdd([{ key: '1-2' }]);
  await db.settings.put({ key: 'baseCurrency', value: 'USD' });
};

beforeEach(async () => { await wipe(); });

describe('export / import round trip', () => {
  it('export, wipe, import gives identical data', async () => {
    await seedDb();
    const before = await snapshot();
    const text = JSON.stringify(await exportBackup());
    await wipe();
    const res = await importBackup(text, 'merge');
    expect(res).toMatchObject({ added: 3, skipped: 0 });
    expect(await snapshot()).toEqual(before);
  });
  it('writes the documented format and keeps dates exact', async () => {
    await seedDb();
    const b = JSON.parse(JSON.stringify(await exportBackup()));
    expect(b).toMatchObject({ app: 'subsweep', version: 2, dismissedDuplicates: ['1-2'], settings: { baseCurrency: 'USD' } });
    expect(typeof b.exportedAt).toBe('string');
    expect(b.subscriptions[0].createdAt).toBe('2026-01-02T10:20:30.456Z');
    expect(b.subscriptions[0].nextRenewal).toBe('2026-11-03');
  });
  it('new rows after a restore get fresh ids', async () => {
    await seedDb();
    const text = JSON.stringify(await exportBackup());
    await importBackup(text, 'replace');
    const id = await db.subs.add({ name: 'New', amount: 1, cycle: 'monthly', nextRenewal: '2026-12-01', category: 'Other', isTrial: false });
    expect(id).toBeGreaterThan(5);
  });
  it('names the backup file by date', () => {
    expect(backupFileName(new Date('2026-10-13T12:00:00Z'))).toBe('subsweep-backup-2026-10-13.json');
  });
});

describe('cancel & verify fields and v1 compatibility', () => {
  const cancelled: Subscription = {
    id: 9, name: 'Netflix', amount: 17.99, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false,
    status: 'cancelled', cancelRequestedAt: '2026-10-20', cancelEffectiveDate: '2026-11-03', cancelRef: 'NF-1', verifiedAt: '2026-12-20',
    zombieCharges: [{ date: '2026-12-03', amount: 17.99 }],
  };
  it('round-trips the new fields', async () => {
    await db.subs.add(cancelled);
    const text = JSON.stringify(await exportBackup());
    await wipe();
    await importBackup(text, 'merge');
    expect(await db.subs.get(9)).toEqual(cancelled);
  });
  it('restores a v1 backup (no cancel fields) as active subscriptions', async () => {
    const v1 = JSON.stringify({ app: 'subsweep', version: 1, subscriptions: seed, dismissedDuplicates: [], settings: {} });
    await importBackup(v1, 'replace');
    const all = await db.subs.toArray();
    expect(all).toHaveLength(3);
    expect(all.every(s => s.status === undefined)).toBe(true);
  });
  it('rejects bad cancel fields', () => {
    const mk = (extra: object) => JSON.stringify({ app: 'subsweep', version: 2, subscriptions: [{ ...seed[0], ...extra }] });
    expect(() => parseBackup(mk({ status: 'gone' }))).toThrow(/"status"/);
    expect(() => parseBackup(mk({ cancelEffectiveDate: 'soon' }))).toThrow(/"cancelEffectiveDate"/);
    expect(() => parseBackup(mk({ zombieCharges: [{ date: '2026-12-03', amount: 'x' }] }))).toThrow(/"zombieCharges"/);
  });
});

describe('currency, simulator and usage fields', () => {
  const rich: Subscription = {
    id: 20, name: 'Spotify', amount: 10, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Music', isTrial: false,
    currency: 'USD', selectedForCancel: true, lastUsedAt: '2026-10-01',
  };
  it('round-trips currency, selection, last-used, base currency, rates and dismissed insights', async () => {
    await db.subs.add(rich);
    await db.settings.bulkPut([
      { key: 'baseCurrency', value: 'INR' }, { key: 'rates', value: { USD: 83.25 } },
      { key: 'ratesNeedReview', value: true }, { key: 'dismissedInsights', value: ['overlap:music:20,21'] },
    ]);
    const before = await snapshot();
    const text = JSON.stringify(await exportBackup());
    await wipe();
    await importBackup(text, 'merge');
    expect(await snapshot()).toEqual(before);
    expect(await db.subs.get(20)).toEqual(rich);
  });
  it('restores a pre-currency backup: rows keep no currency (read as the base), settings untouched', async () => {
    const old = JSON.stringify({ app: 'subsweep', version: 1, subscriptions: [seed[0]], dismissedDuplicates: [], settings: {} });
    await importBackup(old, 'replace');
    const row = await db.subs.get(1);
    expect(row?.currency).toBeUndefined();
    expect(await db.settings.count()).toBe(0);
  });
  it('rejects malformed new fields', () => {
    const mk = (extra: object) => JSON.stringify({ app: 'subsweep', version: 2, subscriptions: [{ ...seed[0], ...extra }] });
    expect(() => parseBackup(mk({ currency: 'dollars' }))).toThrow(/"currency"/);
    expect(() => parseBackup(mk({ selectedForCancel: 'yes' }))).toThrow(/"selectedForCancel"/);
    expect(() => parseBackup(mk({ lastUsedAt: 'yesterday' }))).toThrow(/"lastUsedAt"/);
  });
});

describe('merge mode', () => {
  it('adds missing ids and skips ids that exist', async () => {
    await db.subs.bulkAdd([{ ...seed[0], name: 'Netflix (edited locally)' }]);
    const text = JSON.stringify({ app: 'subsweep', version: 1, exportedAt: new Date().toISOString(), subscriptions: seed, dismissedDuplicates: [], settings: {} });
    const res = await importBackup(text, 'merge');
    expect(res).toMatchObject({ added: 2, skipped: 1 });
    const all = await db.subs.orderBy('id').toArray();
    expect(all.map(s => s.name)).toEqual(['Netflix (edited locally)', 'Hulu', 'Dropbox']);
  });
});

describe('replace mode and invalid files', () => {
  it('replace swaps everything', async () => {
    await db.subs.add({ name: 'Old', amount: 1, cycle: 'monthly', nextRenewal: '2026-12-01', category: 'Other', isTrial: false });
    const text = JSON.stringify({ app: 'subsweep', version: 1, subscriptions: seed });
    await importBackup(text, 'replace');
    expect((await db.subs.toArray()).map(s => s.name).sort()).toEqual(['Dropbox', 'Hulu', 'Netflix']);
  });
  const bad: [string, string, RegExp][] = [
    ['malformed JSON', '{not json', /not valid JSON/],
    ['wrong app', JSON.stringify({ app: 'other', version: 1, subscriptions: [] }), /not a SubSweep backup/],
    ['newer version', JSON.stringify({ app: 'subsweep', version: 99, subscriptions: [] }), /newer version/],
    ['random JSON', JSON.stringify({ hello: 'world' }), /not a SubSweep backup/],
    ['bad cycle', JSON.stringify({ app: 'subsweep', version: 1, subscriptions: [{ ...seed[0], cycle: 'daily' }] }), /"cycle"/],
    ['bad date', JSON.stringify({ app: 'subsweep', version: 1, subscriptions: [{ ...seed[0], nextRenewal: '2026-02-31' }] }), /"nextRenewal"/],
    ['duplicate ids', JSON.stringify({ app: 'subsweep', version: 1, subscriptions: [seed[0], seed[0]] }), /same id/],
  ];
  for (const [label, text, msg] of bad) {
    it(`rejects ${label} and leaves data untouched (replace and merge)`, async () => {
      await seedDb();
      const before = await snapshot();
      for (const mode of ['replace', 'merge'] as const) {
        await expect(importBackup(text, mode)).rejects.toThrow(BackupError);
        await expect(importBackup(text, mode)).rejects.toThrow(msg);
      }
      expect(await snapshot()).toEqual(before);
    });
  }
  it('ignores unknown extra fields', () => {
    const b = parseBackup(JSON.stringify({ app: 'subsweep', version: 1, extra: 1, subscriptions: [{ ...seed[1], mystery: 'x' }] }));
    expect(b.subscriptions[0]).not.toHaveProperty('mystery');
    expect(b).not.toHaveProperty('extra');
  });
});

describe('settings in backups and the restore preview', () => {
  const file = (settings: unknown, subs: unknown[] = []) => JSON.stringify({ app: 'subsweep', version: 2, subscriptions: subs, settings });
  const settingsOf = async () => Object.fromEntries((await db.settings.toArray()).map(r => [r.key, r.value]));

  it('round-trips settings and lastReviewedAt, and only exports known keys', async () => {
    await db.settings.bulkPut([{ key: 'baseCurrency', value: 'INR' }, { key: 'rates', value: { USD: 83 } }, { key: 'reminderDays', value: [1, 7] }, { key: 'mystery', value: 1 }]);
    await db.subs.add({ ...seed[0], id: undefined, lastReviewedAt: '2026-10-01', notes: 'family plan' });
    const text = JSON.stringify(await exportBackup());
    expect(JSON.parse(text).settings.mystery).toBeUndefined();
    await wipe();
    await importBackup(text, 'replace');
    expect(await settingsOf()).toEqual({ baseCurrency: 'INR', rates: { USD: 83 }, reminderDays: [1, 7] });
    const row = (await db.subs.toArray())[0];
    expect(row.lastReviewedAt).toBe('2026-10-01');
    expect(row.notes).toBe('family plan');
  });
  it('a backup without settings leaves current settings untouched, in both modes', async () => {
    await db.settings.put({ key: 'baseCurrency', value: 'EUR' });
    for (const mode of ['merge', 'replace'] as const) {
      await importBackup(JSON.stringify({ app: 'subsweep', version: 1, subscriptions: [] }), mode);
      expect(await settingsOf()).toEqual({ baseCurrency: 'EUR' });
    }
  });
  it('merge keeps existing settings unless asked, but fills ones that are absent', async () => {
    await db.settings.put({ key: 'baseCurrency', value: 'EUR' });
    const f = file({ baseCurrency: 'INR', reminderDays: [3] });
    const r = await importBackup(f, 'merge');
    expect(r.settingsWritten).toBe(1);
    expect(await settingsOf()).toEqual({ baseCurrency: 'EUR', reminderDays: [3] });
    await importBackup(f, 'merge', { applySettings: true });
    expect((await settingsOf()).baseCurrency).toBe('INR');
  });
  it('replace applies file settings by default, never clears others, and can be declined', async () => {
    await db.settings.bulkPut([{ key: 'baseCurrency', value: 'EUR' }, { key: 'reminderDays', value: [1] }]);
    await importBackup(file({ baseCurrency: 'INR' }), 'replace', { applySettings: false });
    expect(await settingsOf()).toEqual({ baseCurrency: 'EUR', reminderDays: [1] });
    await importBackup(file({ baseCurrency: 'INR' }), 'replace');
    expect(await settingsOf()).toEqual({ baseCurrency: 'INR', reminderDays: [1] });
  });
  it('rejects bad rates and unknown keys with warnings instead of applying them', async () => {
    await db.settings.put({ key: 'rates', value: { USD: 80 } });
    const f = file({ rates: { USD: -5, EUR: 'x' }, baseCurrency: 'dollars', evil: 1 });
    const r = await importBackup(f, 'replace');
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
    expect(await settingsOf()).toEqual({ rates: { USD: 80 } });
  });
  it('preview reports counts and setting changes and writes nothing', async () => {
    await db.subs.bulkAdd(seed);
    await db.settings.put({ key: 'baseCurrency', value: 'EUR' });
    const before = await snapshot();
    const f = file({ baseCurrency: 'INR', reminderDays: [3] }, [{ ...seed[0] }, { ...seed[1], id: 77 }]);
    const m = await previewBackup(f, 'merge');
    expect(m.valid).toBe(true);
    expect(m.counts).toMatchObject({ toAdd: 1, toSkip: 1, toReplace: 0, subscriptionsInFile: 2, existing: 3 });
    expect(m.settingsChanges.map(c => c.key)).toEqual(['reminderDays']);
    expect(m.settingsKept.map(c => c.key)).toEqual(['baseCurrency']);
    const rep = await previewBackup(f, 'replace');
    expect(rep.counts).toMatchObject({ toAdd: 2, toReplace: 3 });
    expect(rep.settingsChanges.map(c => c.key).sort()).toEqual(['baseCurrency', 'reminderDays']);
    expect(await snapshot()).toEqual(before);
  });
  it('preview of a broken or foreign file is invalid with readable errors', async () => {
    expect((await previewBackup('nope', 'merge')).errors[0]).toMatch(/not valid JSON/);
    expect((await previewBackup('{"app":"other"}', 'merge')).valid).toBe(false);
  });
});
