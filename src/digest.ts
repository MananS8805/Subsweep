import { isLive, type Subscription } from './types';
import { addCycle } from './detect';
import { convert, type Rates } from './currency';
import { silencedReason } from './reminders';
import { addDays, dayDiff } from './dates';

export const DIGEST_DAYS = 30;

export interface DigestPayment { subId: number; date: string; amountBase: number; muted: boolean; snoozed: boolean }
export interface DigestWeek { start: string; total: number; items: DigestPayment[] }   // start = the Monday of that week
export interface DigestTrial { subId: number; date: string; daysLeft: number }
export interface Digest {
  from: string;                          // first day covered (today)
  to: string;                            // last day covered
  days: number;
  payments: DigestPayment[];             // oldest first
  weeks: DigestWeek[];                   // every calendar week the window touches, empty ones included
  total: number;                         // in the base currency, rate-needed items excluded
  busiestWeek: DigestWeek | null;
  trialsEnding: DigestTrial[];           // not counted in `total` (free until they end)
  mutedCount: number;                    // distinct subscriptions in the window with reminders muted or snoozed
  rateNeeded: { subId: number; currency: string }[];
}

/** The Monday of the week containing `iso` (ISO weeks, so a week runs Monday to Sunday). */
export function weekStart(iso: string): string {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();   // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/**
 * Every date a subscription is charged within [from, toExclusive). Each occurrence is computed from the renewal date as
 * `anchor + k cycles`, so month-end renewals keep their day (Jan 31, Feb 28, Mar 31...) instead of drifting to the 28th.
 * A free trial is a single event on its end date.
 */
export function occurrences(sub: Subscription, from: string, toExclusive: string): string[] {
  const anchor = sub.nextRenewal;
  if (sub.isTrial) return anchor >= from && anchor < toExclusive ? [anchor] : [];
  const out: string[] = [];
  let k = 0, d = anchor;
  for (; d < from && k < 5000; ) d = addCycle(anchor, sub.cycle, ++k);   // skip stale dates
  for (; d < toExclusive && out.length < 400; ) { out.push(d); d = addCycle(anchor, sub.cycle, ++k); }
  return out;
}

/**
 * What is about to be charged. `now` is the local date. The window is `days` calendar days starting today (today up to
 * and including today + days - 1). Muted and snoozed subscriptions still cost money, so they are included and flagged.
 * Charges in a currency with no exchange rate are listed in `rateNeeded` and left out of every total.
 */
export function getDigest(subs: Subscription[], settings: { baseCurrency: string; rates: Rates }, now: string, days = DIGEST_DAYS): Digest {
  const to = addDays(now, days);
  const payments: DigestPayment[] = [];
  const trialsEnding: DigestTrial[] = [];
  const rateNeeded = new Map<number, string>();
  const flagged = new Set<number>();

  for (const s of subs) {
    if (s.id === undefined || !isLive(s)) continue;
    const dates = occurrences(s, now, to);
    if (!dates.length) continue;
    if (s.isTrial) { trialsEnding.push({ subId: s.id, date: dates[0], daysLeft: dayDiff(now, dates[0]) }); continue; }
    const currency = s.currency ?? settings.baseCurrency;
    const amountBase = convert(s.amount, currency, settings.baseCurrency, settings.rates);
    if (amountBase === null) { rateNeeded.set(s.id, currency); continue; }
    const why = silencedReason(s, now);
    if (why) flagged.add(s.id);
    for (const date of dates) payments.push({ subId: s.id, date, amountBase, muted: why === 'muted', snoozed: why === 'snoozed' });
  }
  payments.sort((a, b) => a.date.localeCompare(b.date) || a.subId - b.subId);
  trialsEnding.sort((a, b) => a.date.localeCompare(b.date) || a.subId - b.subId);

  const weeks: DigestWeek[] = [];
  for (let ws = weekStart(now); ws < to; ws = addDays(ws, 7)) {
    const items = payments.filter(p => weekStart(p.date) === ws);
    weeks.push({ start: ws, total: items.reduce((t, p) => t + p.amountBase, 0), items });
  }
  const total = payments.reduce((t, p) => t + p.amountBase, 0);
  const busiest = weeks.reduce<DigestWeek | null>((best, w) => (w.total > (best?.total ?? 0) ? w : best), null);
  return {
    from: now, to: addDays(to, -1), days, payments, weeks, total, busiestWeek: busiest, trialsEnding,
    mutedCount: flagged.size, rateNeeded: [...rateNeeded].map(([subId, currency]) => ({ subId, currency })),
  };
}

/** Plain-text version for "Copy summary". `name` looks a subscription up; `money` formats an amount in the base currency. */
export function digestText(d: Digest, name: (id: number) => string, money: (n: number) => string): string {
  const lines = [`SubSweep: next ${d.days} days (${d.from} to ${d.to})`, `Total due: ${money(d.total)} across ${d.payments.length} payment${d.payments.length === 1 ? '' : 's'}`];
  if (d.busiestWeek) lines.push(`Busiest week: starting ${d.busiestWeek.start}, ${money(d.busiestWeek.total)}`);
  for (const w of d.weeks.filter(w => w.items.length)) {
    lines.push('', `Week of ${w.start}: ${money(w.total)}`);
    for (const p of w.items) lines.push(`  ${p.date}  ${name(p.subId)}  ${money(p.amountBase)}${p.muted ? '  (reminders muted)' : p.snoozed ? '  (reminders snoozed)' : ''}`);
  }
  if (d.trialsEnding.length) {
    lines.push('', 'Free trials ending (not in the total):');
    for (const t of d.trialsEnding) lines.push(`  ${t.date}  ${name(t.subId)}`);
  }
  if (d.rateNeeded.length) lines.push('', `Not counted, exchange rate needed: ${d.rateNeeded.map(r => `${name(r.subId)} (${r.currency})`).join(', ')}`);
  return lines.join('\n');
}
