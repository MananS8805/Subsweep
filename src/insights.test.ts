import { describe, it, expect } from 'vitest';
import { getInsights, visibleInsights, groupsOf, daysBetween } from './insights';
import type { Subscription } from './types';

const NOW = '2026-10-14';
const daysAgo = (n: number) => { const d = new Date(NOW + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
let id = 1;
const sub = (o: Partial<Subscription>): Subscription => ({
  id: id++, name: 'X', amount: 100, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false,
  createdAt: daysAgo(10) + 'T00:00:00.000Z', lastUsedAt: daysAgo(1), ...o,
});
const kinds = (subs: Subscription[]) => getInsights(subs, NOW).map(i => i.type);

describe('overlap', () => {
  it('flags two services in the same group and saves the cheaper one', () => {
    const spotify = sub({ name: 'Spotify', amount: 119 }), apple = sub({ name: 'Apple Music', amount: 99 });
    const [i] = getInsights([spotify, apple, sub({ name: 'Hulu' })], NOW);
    expect(i.type).toBe('overlap');
    expect(i.subIds).toEqual([apple.id]);
    expect(i.potentialYearlySaving).toBe(99 * 12);
    expect(i.title).toMatch(/2 music/);
  });
  it('with three, keeps the priciest and saves the other two', () => {
    const a = sub({ name: 'Netflix', amount: 649 }), b = sub({ name: 'Disney+', amount: 299 }), c = sub({ name: 'Hotstar', amount: 149 });
    const [i] = getInsights([a, b, c], NOW);
    expect(i.type).toBe('overlap');
    expect(i.subIds.sort()).toEqual([b.id, c.id].sort());
    expect(i.potentialYearlySaving).toBe((299 + 149) * 12);
  });
  it('converts to the base currency using rates', () => {
    const a = sub({ name: 'Spotify', amount: 10, currency: 'USD' }), b = sub({ name: 'YouTube Music', amount: 5, currency: 'USD' });
    const [i] = getInsights([a, b], NOW, { base: 'INR', rates: { USD: 80 } });
    expect(i.potentialYearlySaving).toBe(5 * 80 * 12);
  });
  it('does not count a trial, a cancelled plan, or a single service', () => {
    expect(kinds([sub({ name: 'Spotify' }), sub({ name: 'Apple Music', isTrial: true, nextRenewal: '2026-10-16' })])).not.toContain('overlap');
    expect(kinds([sub({ name: 'Spotify' }), sub({ name: 'Apple Music', status: 'cancelled' })])).not.toContain('overlap');
    expect(kinds([sub({ name: 'Spotify' })])).not.toContain('overlap');
  });
  it('does not confuse short names (Max) with longer ones', () => {
    expect(groupsOf('Max')).toContain('video');
    expect(groupsOf('Maxis Broadband')).toEqual([]);
    expect(groupsOf('Disney+')).toContain('video');
    expect(groupsOf('iCloud+')).toContain('storage');
    expect(groupsOf('Adobe Creative Cloud')).toContain('design');
  });
  it('YouTube Premium counts as both music and video', () => {
    expect(groupsOf('YouTube Premium').sort()).toEqual(['music', 'video']);
  });
});

describe('unused thresholds', () => {
  const unused = (o: Partial<Subscription>) => getInsights([sub({ name: 'Calm', ...o })], NOW).filter(i => i.type === 'unused');
  it('marked used: flags only after more than 60 days (59 and 60 pass, 61 flags)', () => {
    expect(unused({ lastUsedAt: daysAgo(59) })).toHaveLength(0);
    expect(unused({ lastUsedAt: daysAgo(60) })).toHaveLength(0);
    expect(unused({ lastUsedAt: daysAgo(61) })).toHaveLength(1);
  });
  it('never marked used: flags only when tracked more than 45 days (44 and 45 pass, 46 flags)', () => {
    expect(unused({ lastUsedAt: undefined, createdAt: daysAgo(44) + 'T00:00:00.000Z' })).toHaveLength(0);
    expect(unused({ lastUsedAt: undefined, createdAt: daysAgo(45) + 'T00:00:00.000Z' })).toHaveLength(0);
    expect(unused({ lastUsedAt: undefined, createdAt: daysAgo(46) + 'T00:00:00.000Z' })).toHaveLength(1);
  });
  it('never flags something marked used recently, however old the record is', () => {
    expect(unused({ lastUsedAt: daysAgo(5), createdAt: daysAgo(900) + 'T00:00:00.000Z' })).toHaveLength(0);
  });
  it('treats old records with no createdAt as long-tracked', () => {
    expect(unused({ lastUsedAt: undefined, createdAt: undefined })).toHaveLength(1);
  });
  it('saves the full yearly cost and skips trials and cancelled plans', () => {
    expect(unused({ lastUsedAt: daysAgo(90), amount: 500 })[0].potentialYearlySaving).toBe(6000);
    expect(unused({ lastUsedAt: daysAgo(90), isTrial: true })).toHaveLength(0);
    expect(unused({ lastUsedAt: daysAgo(90), status: 'cancelling' })).toHaveLength(0);
  });
});

describe('price creep and trials', () => {
  it('reports the extra you now pay per year', () => {
    const [i] = getInsights([sub({ name: 'Netflix', amount: 17.99, priceCreep: { from: 15.49, to: 17.99 } })], NOW);
    expect(i.type).toBe('creep');
    expect(i.potentialYearlySaving).toBeCloseTo(2.5 * 12, 6);
  });
  it('flags a trial ending within 7 days with its post-trial yearly cost', () => {
    const [i] = getInsights([sub({ name: 'Headspace', amount: 100, isTrial: true, nextRenewal: '2026-10-17' })], NOW);
    expect(i.type).toBe('trial');
    expect(i.title).toMatch(/in 3 days/);
    expect(i.potentialYearlySaving).toBe(1200);
    expect(kinds([sub({ isTrial: true, nextRenewal: '2026-11-30' })])).not.toContain('trial');
    expect(kinds([sub({ isTrial: true, nextRenewal: '2026-10-10' })])).not.toContain('trial');
  });
});

describe('dismissing', () => {
  it('hides a dismissed insight and shows it again when the underlying set changes', () => {
    const a = sub({ name: 'Spotify', amount: 119 }), b = sub({ name: 'Apple Music', amount: 99 });
    const first = getInsights([a, b], NOW);
    expect(visibleInsights(first, [first[0].id])).toHaveLength(0);
    const c = sub({ name: 'Tidal', amount: 79 });
    const second = getInsights([a, b, c], NOW);
    expect(second[0].id).not.toBe(first[0].id);
    expect(visibleInsights(second, [first[0].id])).toHaveLength(1);
  });
  it('is stable for identical input', () => {
    const a = sub({ name: 'Spotify' }), b = sub({ name: 'Apple Music' });
    expect(getInsights([a, b], NOW).map(i => i.id)).toEqual(getInsights([b, a], NOW).map(i => i.id));
  });
});

describe('ordering and helpers', () => {
  it('sorts by potential saving, largest first', () => {
    const r = getInsights([sub({ name: 'Calm', amount: 50, lastUsedAt: daysAgo(90) }), sub({ name: 'Peloton', amount: 4000, lastUsedAt: daysAgo(90) })], NOW);
    expect(r.map(i => i.potentialYearlySaving)).toEqual([48000, 600]);
  });
  it('daysBetween ignores time of day', () => {
    expect(daysBetween('2026-10-01T23:59:59.000Z', '2026-10-14')).toBe(13);
  });
});
