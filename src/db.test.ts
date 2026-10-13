import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import Dexie from 'dexie';
import { SubDB } from './db';

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
