import { db } from './db';
import { DEFAULT_BASE, isCurrencyCode, sanitizeRates, type Rates } from './currency';

export interface AppSettings {
  baseCurrency: string;
  rates: Rates;
  ratesNeedReview: boolean;
  dismissedInsights: string[];
}

export const DEFAULT_SETTINGS: AppSettings = { baseCurrency: DEFAULT_BASE, rates: {}, ratesNeedReview: false, dismissedInsights: [] };

/** Read settings defensively: anything missing or malformed (old data, a hand-edited backup) falls back to defaults. */
export async function loadSettings(): Promise<AppSettings> {
  const rows = new Map((await db.settings.toArray()).map(r => [r.key, r.value]));
  const base = rows.get('baseCurrency');
  const dismissed = rows.get('dismissedInsights');
  return {
    baseCurrency: isCurrencyCode(base) ? base : DEFAULT_BASE,
    rates: sanitizeRates(rows.get('rates')),
    ratesNeedReview: rows.get('ratesNeedReview') === true,
    dismissedInsights: Array.isArray(dismissed) ? dismissed.filter((x): x is string => typeof x === 'string') : [],
  };
}

export const saveSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => db.settings.put({ key, value });
