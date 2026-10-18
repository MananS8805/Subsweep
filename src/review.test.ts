import { describe, it, expect } from 'vitest';
import { decisionPatch, getReviewQueue, shouldPromptReview, snoozeUntil } from './review';
import type { Subscription } from './types';

const sub = (o: Partial<Subscription>): Subscription => ({ id: 1, name: 'A', amount: 10, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false, ...o });
const T = '2026-10-19';

describe('getReviewQueue', () => {
  it('includes never-reviewed and 30+ day old, excludes recent, cancelled and cancelling', () => {
    const q = getReviewQueue([
      sub({ id: 1, name: 'never' }),
      sub({ id: 2, name: 'old', lastReviewedAt: '2026-09-19' }),
      sub({ id: 3, name: 'recent', lastReviewedAt: '2026-09-20' }),
      sub({ id: 4, name: 'gone', status: 'cancelled' }),
      sub({ id: 5, name: 'going', status: 'cancelling' }),
    ], T, 'USD', {});
    expect(q.map(s => s.name)).toEqual(['never', 'old']);
  });
  it('orders by monthly cost, unpriced foreign currency last', () => {
    const q = getReviewQueue([
      sub({ id: 1, name: 'cheap', amount: 5 }),
      sub({ id: 2, name: 'yearly', amount: 240, cycle: 'yearly' }),
      sub({ id: 3, name: 'big', amount: 50 }),
      sub({ id: 4, name: 'nofx', amount: 999, currency: 'EUR' }),
    ], T, 'USD', {});
    expect(q.map(s => s.name)).toEqual(['big', 'yearly', 'cheap', 'nofx']);
  });
});

describe('prompt and decisions', () => {
  it('prompts only when something is due and not snoozed', () => {
    expect(shouldPromptReview(0, '', T)).toBe(false);
    expect(shouldPromptReview(2, '', T)).toBe(true);
    expect(shouldPromptReview(2, '2026-10-20', T)).toBe(false);
    expect(shouldPromptReview(2, '2026-10-19', T)).toBe(true);
    expect(snoozeUntil(T)).toBe('2026-10-26');
  });
  it('keep and cancel stamp the review; skip changes nothing', () => {
    expect(decisionPatch('keep', T)).toEqual({ lastReviewedAt: T });
    expect(decisionPatch('cancel', T)).toEqual({ lastReviewedAt: T, selectedForCancel: true });
    expect(decisionPatch('skip', T)).toEqual({});
  });
});
