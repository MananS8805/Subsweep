import { addDays, dayDiff } from './dates';
import { monthlyBase } from './savings';
import type { Rates } from './currency';
import { isLive, type Subscription } from './types';

export const REVIEW_EVERY_DAYS = 30;
export const PROMPT_SNOOZE_DAYS = 7;

export type ReviewDecision = 'keep' | 'cancel' | 'skip';

/** Live subscriptions not reviewed in the last 30 days, most expensive per month first (unpriced ones last). */
export function getReviewQueue(subs: Subscription[], today: string, base: string, rates: Rates): Subscription[] {
  return subs
    .filter(s => isLive(s) && (!s.lastReviewedAt || dayDiff(s.lastReviewedAt, today) >= REVIEW_EVERY_DAYS))
    .map(s => ({ s, cost: monthlyBase(s, base, rates) ?? -1 }))
    .sort((a, b) => b.cost - a.cost || (a.s.name < b.s.name ? -1 : 1))
    .map(x => x.s);
}

/** Whether to show the "time for a review" card: something is due and it has not been snoozed. */
export const shouldPromptReview = (queueLength: number, dismissedUntil: string, today: string) =>
  queueLength > 0 && (!dismissedUntil || dayDiff(dismissedUntil, today) >= 0);

export const snoozeUntil = (today: string) => addDays(today, PROMPT_SNOOZE_DAYS);

/** The fields a decision changes, so the caller can apply and undo them. Skip changes nothing. */
export function decisionPatch(d: ReviewDecision, today: string): Partial<Subscription> {
  if (d === 'keep') return { lastReviewedAt: today };
  if (d === 'cancel') return { lastReviewedAt: today, selectedForCancel: true };
  return {};
}
