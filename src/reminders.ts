import { isLive, type NotifiedReminder, type Subscription } from './types';
import { addDays, dayDiff } from './dates';

/** The "days before renewal" choices offered in settings. */
export const REMINDER_WINDOWS = [1, 3, 7] as const;
export const DEFAULT_REMINDER_DAYS: number[] = [7];
/** A free trial about to convert always gets a reminder this many days out, whatever windows are chosen. */
export const TRIAL_FLOOR_DAYS = 3;
/** Notified keys for renewals older than this are forgotten. */
const KEEP_NOTIFIED_DAYS = 30;

/** Keep only the offered windows, sorted and unique. An empty list is valid: it means "no day-before reminders". */
export function normalizeWindows(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REMINDER_DAYS];
  return [...new Set(raw.filter((n): n is number => (REMINDER_WINDOWS as readonly number[]).includes(n as number)))].sort((a, b) => a - b);
}

export interface DueReminder {
  sub: Subscription;
  daysLeft: number;   // 0 = today
  window: number;     // the configured window that triggered it (the smallest one that still covers daysLeft)
  trial: boolean;
  key: string;        // "<id>|<renewalDate>|<window>": one reminder per renewal per window
}

export const reminderKey = (id: number, renewalDate: string, window: number) => `${id}|${renewalDate}|${window}`;

/** Why a subscription gets no reminders right now, if it does not. Snoozes lapse by themselves on their date. */
export function silencedReason(s: Subscription, now: string): 'muted' | 'snoozed' | null {
  if (s.muted) return 'muted';
  if (s.snoozedUntil && now < s.snoozedUntil) return 'snoozed';
  return null;
}

/** Smallest configured window that covers `daysLeft` (so 5 days out with [1,3,7] is the 7-day window), else null. */
export function windowFor(daysLeft: number, windows: number[]): number | null {
  if (daysLeft < 0) return null;
  const covering = [...windows].sort((a, b) => a - b).find(w => daysLeft <= w);
  return covering ?? null;
}

/**
 * Subscriptions that should be reminded about today. `now` is the LOCAL date. Muted, snoozed, cancelled and
 * already-renewed items are left out (they still count in your totals). Trials ending soon are always included
 * unless muted or snoozed.
 */
export function getDueReminders(subs: Subscription[], settings: { reminderDays: number[] }, now: string): DueReminder[] {
  const out: DueReminder[] = [];
  for (const s of subs) {
    if (s.id === undefined || !isLive(s) || silencedReason(s, now)) continue;
    const daysLeft = dayDiff(now, s.nextRenewal);
    const windows = s.isTrial ? [...new Set([...settings.reminderDays, TRIAL_FLOOR_DAYS])] : settings.reminderDays;
    const window = windowFor(daysLeft, windows);
    if (window === null) continue;
    out.push({ sub: s, daysLeft, window, trial: s.isTrial, key: reminderKey(s.id, s.nextRenewal, window) });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.sub.name.localeCompare(b.sub.name));
}

/** The reminders not yet shown. A window that was already shown for this renewal is skipped; a tighter one is new. */
export const freshReminders = (due: DueReminder[], shown: Iterable<string>): DueReminder[] => {
  const seen = new Set(shown);
  return due.filter(d => !seen.has(d.key));
};

/** Keys safe to forget: their renewal is long past. */
export const staleKeys = (rows: NotifiedReminder[], now: string): string[] =>
  rows.filter(r => dayDiff(r.renewalDate, now) > KEEP_NOTIFIED_DAYS).map(r => r.key);

export const whenText = (daysLeft: number) => (daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`);

/** Heading for the in-app list: "Renewing soon · next today / tomorrow / in N days". */
export const soonestLabel = (due: DueReminder[]): string => (due.length ? `Renewing soon · next ${whenText(Math.min(...due.map(d => d.daysLeft)))}` : 'Renewing soon');

export const snoozeUntil = (now: string, days: number) => addDays(now, days);

export function notificationText(r: DueReminder, price: string): { title: string; body: string } {
  return {
    title: `${r.trial ? 'Trial ends' : 'Renews'} ${whenText(r.daysLeft)}: ${r.sub.name}`,
    body: `${price} on ${r.sub.nextRenewal}`,
  };
}
