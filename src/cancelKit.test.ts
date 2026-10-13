import { describe, it, expect } from 'vitest';
import { cancelKit, cancelEmail, chatScript, disputeMessage, ctxOf } from './cancelKit';
import type { Subscription } from './types';

const sub: Subscription = {
  id: 1, name: 'Netflix', amount: 17.99, cycle: 'monthly', nextRenewal: '2026-11-03', category: 'Streaming', isTrial: false,
  status: 'cancelling', cancelRequestedAt: '2026-10-20', cancelEffectiveDate: '2026-11-03', cancelRef: 'NF-12345',
};

describe('cancelKit', () => {
  it('returns steps, difficulty and a direct link for known services', () => {
    const k = cancelKit('Netflix');
    expect(k.steps).toMatch(/Cancel Membership/);
    expect(k.difficulty).toBe('easy');
    expect(k.link).toMatch(/^https:\/\//);
  });
  it('warns about services known to be tricky', () => {
    expect(cancelKit('Adobe').difficulty).toBe('hard');
    expect(cancelKit('Planet Fitness').difficulty).toBe('phone');
    expect(cancelKit('Planet Fitness').note).toBeTruthy();
  });
  it('falls back to generic steps and no link for unknown services', () => {
    const k = cancelKit('Zorblax Weekly');
    expect(k.link).toBeUndefined();
    expect(k.steps).toMatch(/Zorblax Weekly/);
  });
});

describe('templates', () => {
  const ctx = ctxOf(sub);
  it('fills the cancellation email and chat script', () => {
    const e = cancelEmail(ctx);
    expect(e).toContain('Netflix'); expect(e).toContain('$17.99'); expect(e).toContain('2026-11-03');
    expect(chatScript(ctx)).toContain('2026-11-03');
  });
  it('builds a dispute message with every charge and the reference', () => {
    const d = disputeMessage(ctx, [{ date: '2026-12-03', amount: 17.99 }, { date: '2027-01-03', amount: 17.99 }]);
    expect(d).toContain('2026-10-20'); expect(d).toContain('NF-12345');
    expect(d).toContain('$17.99 on 2026-12-03'); expect(d).toContain('$17.99 on 2027-01-03');
    expect(d).toContain('these charges');
  });
  it('omits the reference line when there is none', () => {
    expect(disputeMessage({ ...ctx, ref: '' }, [{ date: '2026-12-03', amount: 17.99 }])).not.toContain('reference');
  });
});
