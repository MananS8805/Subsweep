import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { exportBackup, importBackup, parseBackup, backupFileName, BackupError } from './backup';
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
  await db.settings.put({ key: 'currency', value: 'USD' });
};

beforeEach(async () => { await wipe(); });

describe('export / import round trip', () => {
  it('export, wipe, import gives identical data', async () => {
    await seedDb();
    const before = await snapshot();
    const text = JSON.stringify(await exportBackup());
    await wipe();
    const res = await importBackup(text, 'merge');
    expect(res).toEqual({ added: 3, skipped: 0 });
    expect(await snapshot()).toEqual(before);
  });
  it('writes the documented format and keeps dates exact', async () => {
    await seedDb();
    const b = JSON.parse(JSON.stringify(await exportBackup()));
    expect(b).toMatchObject({ app: 'subsweep', version: 2, dismissedDuplicates: ['1-2'], settings: { currency: 'USD' } });
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

describe('merge mode', () => {
  it('adds missing ids and skips ids that exist', async () => {
    await db.subs.bulkAdd([{ ...seed[0], name: 'Netflix (edited locally)' }]);
    const text = JSON.stringify({ app: 'subsweep', version: 1, exportedAt: new Date().toISOString(), subscriptions: seed, dismissedDuplicates: [], settings: {} });
    const res = await importBackup(text, 'merge');
    expect(res).toEqual({ added: 2, skipped: 1 });
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
