import { describe, it, expect } from 'vitest';
import { checkCancellations, cancelState, applyCheck } from './zombie';
import { findDuplicates } from './dedupe';
import { isLive, type Subscription } from './types';
import type { Txn } from './detect';

const netflix = (o: Partial<Subscription> = {}): Subscription => ({
  id: 1, name: 'Netflix', amount: 17.99, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false,
  status: 'cancelling', cancelRequestedAt: '2026-10-20', cancelEffectiveDate: '2026-11-03', ...o,
});
const t = (date: string, desc: string, amount: number): Txn => ({ date, desc, amount });

describe('checkCancellations', () => {
  it('flags a charge after the paid-through date as still charging', () => {
    const r = checkCancellations([t('2026-10-03', 'NETFLIX.COM 8665 CA', 17.99), t('2026-11-03', 'NETFLIX.COM 8665 CA', 17.99), t('2026-12-03', 'NETFLIX.COM 8665 CA', 17.99)], [netflix()]);
    expect(r).toEqual([{ id: 1, outcome: 'zombie', charges: [{ date: '2026-12-03', amount: 17.99 }] }]);
  });
  it('ignores the final paid charge on or just after the effective date (grace window)', () => {
    const r = checkCancellations([t('2026-10-03', 'NETFLIX.COM', 17.99), t('2026-11-04', 'NETFLIX.COM', 17.99), t('2026-12-10', 'SPOTIFY USA', 11.99)], [netflix()]);
    expect(r[0].outcome).toBe('verified');
  });
  it('flags a charge once it is past the grace window', () => {
    const r = checkCancellations([t('2026-11-06', 'NETFLIX.COM', 17.99)], [netflix()]);
    expect(r[0].outcome).toBe('zombie');
  });
  it('ignores a charge whose amount is far from the subscription price', () => {
    const r = checkCancellations([t('2026-10-03', 'NETFLIX.COM', 17.99), t('2026-12-03', 'NETFLIX GIFT CARD', 50), t('2026-12-10', 'SPOTIFY', 11.99)], [netflix()]);
    expect(r[0].outcome).toBe('verified');
  });
  it('does not mix up other merchants', () => {
    const r = checkCancellations([t('2026-10-03', 'NETFLIX.COM', 17.99), t('2026-12-03', 'HULU', 17.99), t('2026-12-10', 'SPOTIFY', 11.99)], [netflix()]);
    expect(r[0].outcome).toBe('verified');
  });
  it('is pending when the statement stops before a full cycle has passed', () => {
    const r = checkCancellations([t('2026-10-03', 'NETFLIX.COM', 17.99), t('2026-11-10', 'SPOTIFY', 11.99)], [netflix()]);
    expect(r[0].outcome).toBe('pending');
  });
  it('is pending when the statement starts after the grace window (cannot see the gap)', () => {
    const r = checkCancellations([t('2026-11-20', 'SPOTIFY', 11.99), t('2026-12-20', 'SPOTIFY', 11.99)], [netflix()]);
    expect(r[0].outcome).toBe('pending');
  });
  it('only looks at cancelling/cancelled subscriptions', () => {
    const live = { ...netflix(), status: undefined };
    expect(checkCancellations([t('2026-12-03', 'NETFLIX.COM', 17.99)], [live])).toEqual([]);
    expect(checkCancellations([], [netflix()])).toEqual([]);
  });
  it('matches a subscription named with extra words', () => {
    const r = checkCancellations([t('2026-10-03', 'SPOTIFY USA', 11.99), t('2026-12-03', 'SPOTIFY USA', 11.99)], [netflix({ name: 'Spotify Premium', amount: 11.99, cycle: 'monthly' })]);
    expect(r[0].outcome).toBe('zombie');
  });
});

describe('applyCheck and cancelState', () => {
  it('records zombie charges, then verification', () => {
    const z = applyCheck({ id: 1, outcome: 'zombie', charges: [{ date: '2026-12-03', amount: 17.99 }] }, '2026-12-05')!;
    expect(cancelState({ ...netflix(), ...z }, '2026-12-05')).toBe('zombie');
    const v = applyCheck({ id: 1, outcome: 'verified', charges: [] }, '2026-12-20')!;
    expect(v).toMatchObject({ status: 'cancelled', verifiedAt: '2026-12-20', zombieCharges: [] });
    expect(cancelState({ ...netflix(), ...v }, '2026-12-20')).toBe('verified');
    expect(applyCheck({ id: 1, outcome: 'pending', charges: [] }, '2026-12-20')).toBeNull();
  });
  it('moves from cancelling to awaiting once the paid period is over', () => {
    expect(cancelState(netflix(), '2026-10-25')).toBe('cancelling');
    expect(cancelState(netflix(), '2026-11-03')).toBe('cancelling');
    expect(cancelState(netflix(), '2026-11-04')).toBe('awaiting');
    expect(cancelState({ ...netflix(), status: undefined }, '2026-11-04')).toBe('active');
  });
  it('a cancelled plan is not live and is not flagged as a duplicate of a new one', () => {
    expect(isLive(netflix())).toBe(false);
    expect(isLive({ ...netflix(), status: undefined })).toBe(true);
    const fresh: Subscription = { ...netflix(), id: 2, status: undefined };
    expect(findDuplicates([netflix(), fresh])).toHaveLength(0);
  });
});
