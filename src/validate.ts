import { isDuplicate } from './dedupe';
import { isLive, type Subscription } from './types';
import { validateLabel } from './paymentMethods';

export const NOTES_MAX = 500;

/** Trim a note and enforce the length limit. Empty notes become undefined so the field is simply absent. */
export function normalizeNotes(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return t ? t.slice(0, NOTES_MAX) : undefined;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string) => ISO.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

/**
 * The one set of rules for saving a subscription, used by the full edit form and quick-add alike.
 * Returns a plain sentence describing the first problem, or null when it is fine.
 */
export function validateSubscription(s: Pick<Subscription, 'name' | 'amount' | 'nextRenewal'> & { notes?: string; paymentMethod?: string }): string | null {
  if (!s.name || !s.name.trim()) return 'Enter a name.';
  if (!Number.isFinite(s.amount) || !(s.amount > 0)) return 'Enter an amount greater than 0.';
  if (!s.nextRenewal || !validDay(s.nextRenewal)) return 'Choose a valid next renewal date.';
  if ((s.notes ?? '').trim().length > NOTES_MAX) return `Notes can be at most ${NOTES_MAX} characters.`;
  const pm = validateLabel(s.paymentMethod ?? '');
  if (pm) return pm;
  return null;
}

/** An existing subscription that looks like the one about to be added, so the user can be warned before saving. */
export function findLookalike(candidate: Pick<Subscription, 'name' | 'amount' | 'isTrial'>, existing: Subscription[]): Subscription | null {
  const probe = { ...candidate, id: -1, cycle: 'monthly', nextRenewal: '', category: '' } as Subscription;
  return existing.find(s => isLive(s) && isDuplicate(probe, s)) ?? null;
}
