import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { SubDB } from './db';

describe('v0.2 -> v0.3 upgrade', () => {
  it('keeps v2 rows and reads them as active (no cancel fields)', async () => {
    const name = 'subsweep-upgrade-test-v3';
    const old = new Dexie(name);
    old.version(2).stores({ subs: '++id, name, nextRenewal', dismissedDuplicates: '++id, &key', settings: 'key' });
    await old.table('subs').add({ name: 'Netflix', amount: 15.49, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false, createdAt: '2026-01-01T00:00:00.000Z' });
    await old.table('dismissedDuplicates').add({ key: '1-2' });
    await old.table('settings').put({ key: 'currency', value: 'USD' });
    old.close();

    const upgraded = new SubDB(name);
    const [row] = await upgraded.subs.toArray();
    expect(row).toMatchObject({ name: 'Netflix', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(row.status).toBeUndefined();
    await upgraded.subs.update(row.id!, { status: 'cancelling', cancelEffectiveDate: '2026-11-03' });
    expect((await upgraded.subs.get(row.id!))?.status).toBe('cancelling');
    expect(await upgraded.dismissedDuplicates.count()).toBe(1);
    expect((await upgraded.settings.get('currency'))?.value).toBe('USD');
    upgraded.close();
  });
});

describe('v0.1 -> v0.2 upgrade', () => {
  it('keeps existing subscriptions and adds the new tables', async () => {
    const name = 'subsweep-upgrade-test';
    const old = new Dexie(name);
    old.version(1).stores({ subs: '++id, name, nextRenewal' });
    await old.table('subs').bulkAdd([
      { name: 'Netflix', amount: 15.49, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false },
      { name: 'Hulu', amount: 7.99, cycle: 'monthly', nextRenewal: '2026-11-05', category: 'Streaming', isTrial: false },
    ]);
    old.close();

    const upgraded = new SubDB(name);
    const rows = await upgraded.subs.orderBy('id').toArray();
    expect(rows.map(r => r.name)).toEqual(['Netflix', 'Hulu']);
    expect(rows[0]).toMatchObject({ amount: 15.49, nextRenewal: '2026-11-03' });
    await upgraded.dismissedDuplicates.add({ key: '1-2' });
    await expect(upgraded.dismissedDuplicates.add({ key: '1-2' })).rejects.toThrow();
    expect(await upgraded.settings.count()).toBe(0);
    upgraded.close();
  });
});
