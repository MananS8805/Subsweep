import { describe, it, expect } from 'vitest';
import { findDuplicates, mergeSubscriptions, normalizeName, groupPairKeys, pairKey, isAlreadyTracked } from './dedupe';
import type { Subscription } from './types';

let nextId = 1;
const sub = (o: Partial<Subscription>): Subscription => ({
  id: nextId++, name: 'Netflix', amount: 15.49, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Other', isTrial: false, ...o,
});

describe('normalizeName', () => {
  it('strips punctuation, spaces and company suffixes', () => {
    expect(normalizeName('Netflix.com Inc')).toBe('netflix');
    expect(normalizeName('  Disney+  Payment ')).toBe('disney');
    expect(normalizeName('Apple Music')).toBe('applemusic');
  });
});

describe('findDuplicates', () => {
  it('flags exact name matches', () => {
    const g = findDuplicates([sub({ name: 'Netflix' }), sub({ name: 'NETFLIX.COM' })]);
    expect(g).toHaveLength(1); expect(g[0]).toHaveLength(2);
  });
  it('exact name match is a duplicate even when amounts differ', () => {
    expect(findDuplicates([sub({ amount: 15.49 }), sub({ amount: 22.99 })])).toHaveLength(1);
  });
  it('flags fuzzy matches with close amounts', () => {
    expect(findDuplicates([sub({ name: 'Spotify', amount: 11.99 }), sub({ name: 'Spotifi', amount: 12.2 })])).toHaveLength(1);
  });
  it('does not flag fuzzy matches with different amounts', () => {
    expect(findDuplicates([sub({ name: 'Spotify', amount: 11.99 }), sub({ name: 'Spotifi', amount: 24 })])).toHaveLength(0);
  });
  it('does not flag different services', () => {
    expect(findDuplicates([sub({ name: 'Netflix' }), sub({ name: 'Hulu', amount: 15.49 })])).toHaveLength(0);
  });
  it('trial vs paid plan with different prices is not a duplicate', () => {
    expect(findDuplicates([sub({ isTrial: true, amount: 0.99 }), sub({ isTrial: false, amount: 15.49 })])).toHaveLength(0);
  });
  it('skips dismissed pairs', () => {
    const a = sub({}), b = sub({});
    expect(findDuplicates([a, b], [pairKey(a.id!, b.id!)])).toHaveLength(0);
  });
  it('groups three or more items', () => {
    const g = findDuplicates([sub({}), sub({ name: 'netflix' }), sub({ name: 'Netflix Inc' }), sub({ name: 'Hulu', amount: 7.99 })]);
    expect(g).toHaveLength(1); expect(g[0]).toHaveLength(3);
    expect(groupPairKeys(g[0])).toHaveLength(3);
  });
});

describe('mergeSubscriptions', () => {
  it('keeps oldest createdAt and id, latest price, manual edits and price history', () => {
    const old = sub({ id: 10, createdAt: '2026-01-01T00:00:00.000Z', amount: 15.49, category: 'Streaming', nextRenewal: '2026-11-03' });
    const mid = sub({ id: 11, createdAt: '2026-03-01T00:00:00.000Z', amount: 15.99, notes: 'family plan' });
    const latest = sub({ id: 12, createdAt: '2026-06-01T00:00:00.000Z', amount: 17.99, nextRenewal: '2026-11-10' });
    const { keep, removeIds } = mergeSubscriptions([latest, old, mid]);
    expect(keep.id).toBe(10);
    expect(keep.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(keep.amount).toBe(17.99);
    expect(keep.nextRenewal).toBe('2026-11-10');
    expect(keep.category).toBe('Streaming');
    expect(keep.notes).toBe('family plan');
    expect(removeIds.sort()).toEqual([11, 12]);
    expect(keep.priceHistory?.map(h => h.amount)).toEqual([15.49, 15.99]);
  });
  it('treats v0.1 rows without createdAt as oldest, ordered by id', () => {
    const a = sub({ id: 1 }), b = sub({ id: 2, createdAt: '2026-05-01T00:00:00.000Z', amount: 17.99 });
    const { keep, removeIds } = mergeSubscriptions([b, a]);
    expect(keep.id).toBe(1); expect(keep.createdAt).toBeUndefined(); expect(keep.amount).toBe(17.99); expect(removeIds).toEqual([2]);
  });
  it('refuses a single item', () => { expect(() => mergeSubscriptions([sub({})])).toThrow(); });
});

describe('isAlreadyTracked', () => {
  it('matches by normalized name', () => {
    expect(isAlreadyTracked('Netflix', [sub({ name: 'NETFLIX.COM' })])).toBe(true);
    expect(isAlreadyTracked('Hulu', [sub({ name: 'Netflix' })])).toBe(false);
  });
});
