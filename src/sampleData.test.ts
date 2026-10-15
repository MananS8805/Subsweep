import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { loadSampleData, removeSampleData, sampleSubscriptions, SAMPLE_NOTE } from './sampleData';
import { parseBackup } from './backup';
import { getInsights } from './insights';
import { loadSettings } from './settings';
import { totals } from './savings';
import { cancelState } from './zombie';
import type { Subscription } from './types';

const TODAY = '2026-10-15';
const wipe = () => Promise.all([db.subs.clear(), db.dismissedDuplicates.clear(), db.settings.clear()]);
beforeEach(async () => { await wipe(); });

describe('sampleSubscriptions', () => {
  const rows = sampleSubscriptions(TODAY);
  it('is valid backup data (so it round-trips) and every row is labelled as fake', () => {
    const text = JSON.stringify({ app: 'subsweep', version: 2, subscriptions: rows.map((r, i) => ({ ...r, id: i + 1 })) });
    expect(parseBackup(text).subscriptions).toHaveLength(rows.length);
    expect(rows.every(r => r.notes === SAMPLE_NOTE)).toBe(true);
  });
  it('uses relative dates, so loading it later gives the same picture', () => {
    const later = sampleSubscriptions('2027-03-01');
    expect(later[0].nextRenewal).not.toBe(rows[0].nextRenewal);
    const gap = (r: typeof rows) => (+new Date(r[0].nextRenewal) - +new Date(r[0].createdAt!.slice(0, 10))) / 86400000;
    expect(gap(later)).toBe(gap(rows));
  });
  it('showcases every feature: insights, multi-currency, trial, verified and still-charging cancellations', () => {
    const subs = rows.map((r, i) => ({ ...r, id: i + 1 })) as Subscription[];
    const types = new Set(getInsights(subs, TODAY, { base: 'INR', rates: { USD: 83, EUR: 90 } }).map(i => i.type));
    expect(types).toEqual(new Set(['overlap', 'unused', 'creep', 'trial']));
    expect(new Set(subs.map(s => s.currency))).toEqual(new Set(['INR', 'USD', 'EUR']));
    const states = subs.map(s => cancelState(s, TODAY));
    expect(states).toContain('verified');
    expect(states).toContain('zombie');
    expect(totals(subs, 'INR', { USD: 83, EUR: 90 }).missing).toEqual([]);
  });
});

describe('loadSampleData / removeSampleData', () => {
  it('loads into an empty database, sets INR + sample rates and remembers the ids', async () => {
    const n = await loadSampleData(TODAY);
    expect(n).toBe(sampleSubscriptions(TODAY).length);
    const s = await loadSettings();
    expect(s.baseCurrency).toBe('INR');
    expect(s.rates).toEqual({ USD: 83, EUR: 90 });
    expect(s.sampleIds).toHaveLength(n);
  });
  it('refuses to mix with real data', async () => {
    await db.subs.add({ name: 'Mine', amount: 5, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false });
    await expect(loadSampleData(TODAY)).rejects.toThrow(/no subscriptions/);
    expect(await db.subs.count()).toBe(1);
  });
  it('removes only the sample rows, even if the user added their own meanwhile', async () => {
    await loadSampleData(TODAY);
    await db.subs.add({ name: 'Mine', amount: 5, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false });
    const { sampleIds } = await loadSettings();
    const removed = await removeSampleData(sampleIds);
    expect(removed).toBe(sampleIds.length);
    expect((await db.subs.toArray()).map(s => s.name)).toEqual(['Mine']);
    expect((await loadSettings()).sampleIds).toEqual([]);
  });
  it('never deletes a row whose id was reused by something that is not sample data', async () => {
    const id = await db.subs.add({ name: 'Real', amount: 5, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false });
    expect(await removeSampleData([id])).toBe(0);
    expect(await db.subs.count()).toBe(1);
  });
});
