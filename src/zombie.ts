import type { Cycle, Subscription } from './types';
import { normalizeMerchant, type Txn } from './detect';
import { normalizeName, similarity } from './dedupe';

/** Days after the paid-through date before a charge counts as "still charging" (banks post late). */
export const GRACE_DAYS = 2;
const CYCLE_DAYS: Record<Cycle, number> = { weekly: 7, monthly: 31, quarterly: 92, yearly: 366 };
const AMOUNT_TOLERANCE = 0.15;

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type CancelState = 'active' | 'cancelling' | 'awaiting' | 'verified' | 'zombie';

/**
 * Where a subscription is in the cancel & verify loop:
 * cancelling = still inside the paid period, awaiting = period over but no statement has confirmed it yet.
 */
export function cancelState(s: Subscription, today: string): CancelState {
  if (!s.status || s.status === 'active') return 'active';
  if (s.zombieCharges?.length) return 'zombie';
  if (s.verifiedAt) return 'verified';
  return s.cancelEffectiveDate && today <= s.cancelEffectiveDate ? 'cancelling' : 'awaiting';
}

function sameMerchant(t: Txn, s: Subscription): boolean {
  const key = normalizeMerchant(t.desc), name = normalizeMerchant(s.name);
  if (key.length < 2 || name.length < 2) return false;
  return key === name || similarity(normalizeName(key), normalizeName(name)) >= 0.85;
}

export interface CancellationCheck {
  id: number;
  outcome: 'zombie' | 'verified' | 'pending';
  charges: { date: string; amount: number }[];
}

/**
 * Compare a fresh statement against subscriptions you have cancelled.
 *  zombie   - a matching charge landed after the paid-through date (plus grace)
 *  verified - the statement spans the paid-through date and a full billing cycle after it, with no such charge
 *  pending  - the statement does not cover enough time to say either way
 */
export function checkCancellations(txns: Txn[], subs: Subscription[]): CancellationCheck[] {
  if (!txns.length) return [];
  const dates = txns.map(t => t.date).sort();
  const first = dates[0], last = dates[dates.length - 1];
  const out: CancellationCheck[] = [];
  for (const s of subs) {
    if (s.id === undefined || !s.status || s.status === 'active' || !s.cancelEffectiveDate) continue;
    const eff = s.cancelEffectiveDate;
    const after = addDays(eff, GRACE_DAYS);
    const charges = txns
      .filter(t => t.date > after && sameMerchant(t, s) && Math.abs(t.amount - s.amount) <= s.amount * AMOUNT_TOLERANCE)
      .map(t => ({ date: t.date, amount: t.amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (charges.length) { out.push({ id: s.id, outcome: 'zombie', charges }); continue; }
    const covers = first <= after && last >= addDays(eff, CYCLE_DAYS[s.cycle]);
    out.push({ id: s.id, outcome: covers ? 'verified' : 'pending', charges: [] });
  }
  return out;
}

/** The fields to write back to a subscription for a check result (nothing for "pending"). */
export function applyCheck(c: CancellationCheck, today: string): Partial<Subscription> | null {
  if (c.outcome === 'zombie') return { status: 'cancelled', zombieCharges: c.charges, verifiedAt: undefined };
  if (c.outcome === 'verified') return { status: 'cancelled', zombieCharges: [], verifiedAt: today };
  return null;
}
