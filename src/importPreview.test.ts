import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { buildPreview, defaultChecked, idsInBatch, newBatchId, selectedItems, toSubscriptions, isValid, addedMessage } from './importPreview';
import { detectRecurring } from './detect';
import type { Detected, Subscription } from './types';

const det = (o: Partial<Detected>): Detected => ({
  name: 'Netflix', amount: 17.99, cycle: 'monthly', firstDate: '2026-05-03', lastDate: '2026-09-03', nextRenewal: '2026-10-03', occurrences: 5,
  priceCreep: null, confidence: 0.9, priceHistory: [{ date: '2026-05-03', amount: 17.99 }], ...o,
});
const existing = (name: string): Subscription => ({ id: 1, name, amount: 5, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false });
const cat = () => 'Other';

describe('buildPreview', () => {
  const items = buildPreview([
    det({ name: 'Low One', confidence: 0.3 }), det({ name: 'High One', confidence: 0.9 }), det({ name: 'Mid One', confidence: 0.6 }), det({ name: 'Spotify', confidence: 0.95 }),
  ], [existing('SPOTIFY')], cat, 'INR');

  it('sorts by confidence, with anything already tracked last', () => {
    expect(items.map(i => i.name)).toEqual(['High One', 'Mid One', 'Low One', 'Spotify']);
  });
  it('ticks High and Medium by default and leaves Low unticked', () => {
    expect(defaultChecked('High')).toBe(true); expect(defaultChecked('Medium')).toBe(true); expect(defaultChecked('Low')).toBe(false);
    expect(items.map(i => [i.name, i.checked])).toEqual([['High One', true], ['Mid One', true], ['Low One', false], ['Spotify', false]]);
  });
  it('marks already-tracked items, unticked, even when very confident', () => {
    const t = items.find(i => i.name === 'Spotify')!;
    expect(t.alreadyTracked).toBe(true); expect(t.checked).toBe(false); expect(t.label).toBe('High');
  });
  it('falls back to the base currency when the statement showed none', () => {
    expect(items[0].currency).toBe('INR');
    expect(buildPreview([det({ currency: 'USD' })], [], cat, 'INR')[0].currency).toBe('USD');
  });
  it('is built from detection output directly (real statement round trip)', () => {
    const txns = ['2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10'].map(date => ({ date, desc: 'SPOTIFY USA', amount: 11.99 }));
    const p = buildPreview(detectRecurring(txns, '2026-09-01'), [], cat, 'INR');
    expect(p).toHaveLength(1); expect(p[0].label).toBe('High'); expect(p[0].checked).toBe(true);
  });
});

describe('selection', () => {
  it('only ticked, valid, untracked rows are selected', () => {
    const items = buildPreview([det({ name: 'A' }), det({ name: 'B' }), det({ name: 'C', confidence: 0.2 })], [existing('B')], cat, 'INR');
    expect(selectedItems(items).map(i => i.name)).toEqual(['A']);
    items.find(i => i.name === 'C')!.checked = true;
    expect(selectedItems(items).map(i => i.name).sort()).toEqual(['A', 'C']);
  });
  it('a tracked row can never be selected, even if something ticks it', () => {
    const items = buildPreview([det({ name: 'B' })], [existing('B')], cat, 'INR');
    items[0].checked = true;
    expect(selectedItems(items)).toEqual([]);
  });
  it('rows with no name or no positive amount are not added (so zero valid rows disables the button)', () => {
    const [a] = buildPreview([det({ name: 'A' })], [], cat, 'INR');
    expect(isValid(a)).toBe(true);
    expect(isValid({ ...a, name: '  ' })).toBe(false);
    expect(isValid({ ...a, amount: 0 })).toBe(false);
    expect(isValid({ ...a, amount: NaN })).toBe(false);
    expect(selectedItems([{ ...a, amount: 0 }])).toEqual([]);
    expect(selectedItems([{ ...a, checked: false }])).toEqual([]);
  });
});

describe('toSubscriptions (edits are applied)', () => {
  const NOW = '2026-10-16T09:00:00.000Z', TODAY = '2026-10-16';
  it('uses the edited name, amount, cycle and category, and stamps the batch', () => {
    const [i] = buildPreview([det({ name: 'Netflix', priceHistory: [{ date: '2026-05-03', amount: 15.49 }, { date: '2026-08-03', amount: 17.99 }], priceCreep: { from: 15.49, to: 17.99 } })], [], cat, 'INR');
    Object.assign(i, { name: ' Netflix Premium ', amount: 19.99, cycle: 'quarterly', category: 'Streaming' });
    const [s] = toSubscriptions([i], 'batch-1', NOW, TODAY);
    expect(s).toMatchObject({ name: 'Netflix Premium', amount: 19.99, cycle: 'quarterly', category: 'Streaming', importBatchId: 'batch-1', createdAt: NOW, confidence: 0.9, isTrial: false, currency: 'INR' });
    expect(s.priceHistory).toEqual([{ date: '2026-05-03', amount: 15.49 }, { date: '2026-08-03', amount: 17.99 }, { date: '2026-09-03', amount: 19.99 }]);
    expect(s.priceCreep).toEqual({ from: 15.49, to: 17.99 });
    expect(s.nextRenewal >= TODAY).toBe(true);
  });
  it('keeps detected history untouched when the amount is not edited', () => {
    const [i] = buildPreview([det({})], [], cat, 'INR');
    expect(toSubscriptions([i], 'b', NOW, TODAY)[0].priceHistory).toEqual([{ date: '2026-05-03', amount: 17.99 }]);
  });
  it('recomputes the next renewal from the edited cycle', () => {
    const [i] = buildPreview([det({ lastDate: '2026-09-03' })], [], cat, 'INR');
    expect(toSubscriptions([i], 'b', NOW, TODAY)[0].nextRenewal).toBe('2026-11-03');
    expect(toSubscriptions([{ ...i, cycle: 'weekly' }], 'b', NOW, TODAY)[0].nextRenewal).toBe('2026-10-22');
  });
  it('adds nothing when nothing is selected', () => {
    expect(toSubscriptions(buildPreview([det({ confidence: 0.1 })], [], cat, 'INR'), 'b', NOW, TODAY)).toEqual([]);
  });
});

describe('undo by batch id', () => {
  beforeEach(async () => { await Promise.all([db.subs.clear(), db.settings.clear()]); });
  const row = (name: string, importBatchId?: string): Subscription => ({ name, amount: 5, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false, ...(importBatchId ? { importBatchId } : {}) });

  it('ids come only from the requested batch', async () => {
    await db.subs.bulkAdd([row('Mine'), row('A1', 'b1'), row('A2', 'b1'), row('B1', 'b2')]);
    const all = await db.subs.toArray();
    expect(idsInBatch(all, 'b1').length).toBe(2);
    expect(idsInBatch(all, 'b2').length).toBe(1);
    expect(idsInBatch(all, 'nope')).toEqual([]);
  });
  it('deleting a batch removes exactly that import and restores nothing else', async () => {
    await db.subs.bulkAdd([row('Mine'), row('Earlier import', 'old'), row('A1', 'b1'), row('A2', 'b1')]);
    await db.subs.bulkDelete(idsInBatch(await db.subs.toArray(), 'b1'));
    expect((await db.subs.toArray()).map(s => s.name).sort()).toEqual(['Earlier import', 'Mine']);
  });
  it('a leftover batch id on a row is harmless: it loads, edits and backs up like any other row', async () => {
    const id = await db.subs.add(row('Leftover', 'ancient-batch'));
    await db.subs.update(id, { amount: 9 });
    expect((await db.subs.get(id))?.amount).toBe(9);
    expect(idsInBatch(await db.subs.toArray(), 'a-different-batch')).toEqual([]);
  });
  it('batch ids are unique per import', () => {
    expect(newBatchId(1)).not.toBe(newBatchId(1));
    expect(addedMessage(1)).toBe('Added 1 subscription.'); expect(addedMessage(3)).toBe('Added 3 subscriptions.');
  });
});
