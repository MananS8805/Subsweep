import { db } from './db';
import { DEFAULT_BASE, isCurrencyCode, sanitizeRates, type Rates } from './currency';
import { DEFAULT_REMINDER_DAYS, normalizeWindows } from './reminders';

export interface AppSettings {
  baseCurrency: string;
  rates: Rates;
  ratesNeedReview: boolean;
  dismissedInsights: string[];
  sampleIds: number[]; // rows added by "Load sample data"
  reminderDays: number[]; // days before a renewal to remind, any of 1, 3, 7
  reminderBannerDismissed: boolean; // the "notifications are blocked" note was closed
  onboardingDismissed: boolean; // the welcome panel was skipped, or the first subscription was added
  reviewPromptDismissedUntil: string; // YYYY-MM-DD: the monthly review card stays hidden until this day (empty = not snoozed)
}

export const DEFAULT_SETTINGS: AppSettings = { baseCurrency: DEFAULT_BASE, rates: {}, ratesNeedReview: false, dismissedInsights: [], sampleIds: [], reminderDays: [...DEFAULT_REMINDER_DAYS], reminderBannerDismissed: false, onboardingDismissed: false, reviewPromptDismissedUntil: '' };

/** Read settings defensively: anything missing or malformed (old data, a hand-edited backup) falls back to defaults. */
export async function loadSettings(): Promise<AppSettings> {
  const rows = new Map((await db.settings.toArray()).map(r => [r.key, r.value]));
  const base = rows.get('baseCurrency');
  const dismissed = rows.get('dismissedInsights');
  const sample = rows.get('sampleIds');
  return {
    baseCurrency: isCurrencyCode(base) ? base : DEFAULT_BASE,
    rates: sanitizeRates(rows.get('rates')),
    ratesNeedReview: rows.get('ratesNeedReview') === true,
    dismissedInsights: Array.isArray(dismissed) ? dismissed.filter((x): x is string => typeof x === 'string') : [],
    reminderDays: rows.has('reminderDays') ? normalizeWindows(rows.get('reminderDays')) : [...DEFAULT_REMINDER_DAYS],
    reminderBannerDismissed: rows.get('reminderBannerDismissed') === true,
    onboardingDismissed: rows.get('onboardingDismissed') === true,
    reviewPromptDismissedUntil: typeof rows.get('reviewPromptDismissedUntil') === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rows.get('reviewPromptDismissedUntil') as string) ? (rows.get('reviewPromptDismissedUntil') as string) : '',
    sampleIds: Array.isArray(sample) ? sample.filter((x): x is number => Number.isInteger(x) && x > 0) : [],
  };
}

export const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => db.settings.put({ key, value });
