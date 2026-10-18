import { isCurrencyCode, isValidRate, type Rates } from './currency';
import { normalizeWindows } from './reminders';

/** Every setting SubSweep stores. A backup carries these; anything else in a file is ignored. */
export const SETTING_KEYS = [
  'baseCurrency', 'rates', 'ratesNeedReview', 'reminderDays', 'reminderBannerDismissed',
  'dismissedInsights', 'sampleIds', 'reviewPromptDismissedUntil',
] as const;
export type SettingKey = typeof SETTING_KEYS[number];
export const isKnownSetting = (k: string): k is SettingKey => (SETTING_KEYS as readonly string[]).includes(k);

export interface CleanSettings {
  values: Partial<Record<SettingKey, unknown>>; // only well-formed, known settings
  warnings: string[];                           // bad entries that were left out, in plain words
  ignored: string[];                            // keys this version does not know
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIsoDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const show = (v: unknown) => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };

/**
 * Validate the settings section of a backup. Nothing malformed is ever applied: a bad rate, a bad currency code or a
 * wrong type is dropped and reported, the rest of the file still restores. Unknown keys are ignored, never applied.
 */
export function cleanSettings(raw: unknown): CleanSettings {
  const out: CleanSettings = { values: {}, warnings: [], ignored: [] };
  if (raw === undefined || raw === null) return out;
  if (!isObj(raw)) { out.warnings.push('Ignored the settings in this file: they are not in the expected format.'); return out; }

  for (const [key, v] of Object.entries(raw)) {
    if (!isKnownSetting(key)) { out.ignored.push(key); continue; }
    switch (key) {
      case 'baseCurrency':
        if (isCurrencyCode(v)) out.values.baseCurrency = v; else out.warnings.push(`Ignored base currency ${show(v)}: it is not a 3-letter currency code.`);
        break;
      case 'rates': {
        if (!isObj(v)) { out.warnings.push('Ignored exchange rates: they are not a list of rates.'); break; }
        const good: Rates = {};
        let bad = 0;
        for (const [code, rate] of Object.entries(v)) {
          if (!isCurrencyCode(code)) { out.warnings.push(`Ignored a rate for ${show(code)}: that is not a currency code.`); bad++; }
          else if (!isValidRate(rate)) { out.warnings.push(`Ignored the rate for ${code}: ${show(rate)} is not a positive number.`); bad++; }
          else good[code] = rate;
        }
        // if every entry was bad, leave the rates you already have alone rather than wiping them
        if (bad === 0 || Object.keys(good).length > 0) out.values.rates = good;
        break;
      }
      case 'ratesNeedReview': case 'reminderBannerDismissed':
        if (typeof v === 'boolean') out.values[key] = v; else out.warnings.push(`Ignored the setting "${key}": it should be true or false.`);
        break;
      case 'reminderDays': {
        if (!Array.isArray(v)) { out.warnings.push('Ignored the reminder days: they are not a list.'); break; }
        const days = normalizeWindows(v);
        if (days.length !== new Set(v).size) out.warnings.push('Ignored reminder days other than 1, 3 and 7.');
        out.values.reminderDays = days;
        break;
      }
      case 'dismissedInsights':
        if (Array.isArray(v)) out.values.dismissedInsights = v.filter((x): x is string => typeof x === 'string'); else out.warnings.push('Ignored dismissed insights: not a list.');
        break;
      case 'sampleIds':
        if (Array.isArray(v)) out.values.sampleIds = v.filter((x): x is number => Number.isInteger(x) && x > 0); else out.warnings.push('Ignored the sample-data ids: not a list.');
        break;
      case 'reviewPromptDismissedUntil':
        if (isIsoDay(v)) out.values.reviewPromptDismissedUntil = v; else out.warnings.push(`Ignored the review reminder date ${show(v)}: it is not a date.`);
        break;
    }
  }
  return out;
}

const LABELS: Record<SettingKey, string> = {
  baseCurrency: 'Base currency', rates: 'Exchange rates', ratesNeedReview: 'Rates need review', reminderDays: 'Reminder days',
  reminderBannerDismissed: 'Blocked-notifications note dismissed', dismissedInsights: 'Dismissed insights', sampleIds: 'Sample data rows',
  reviewPromptDismissedUntil: 'Monthly review reminder snoozed until',
};
export const settingLabel = (key: string) => (isKnownSetting(key) ? LABELS[key] : key);

/** A short, human reading of a setting value for the restore preview. */
export function settingText(key: string, v: unknown): string {
  if (v === undefined) return 'Not set';
  if (key === 'rates' && isObj(v)) { const e = Object.entries(v); return e.length ? e.map(([c, r]) => `1 ${c} = ${r}`).join(', ') : 'None'; }
  if (key === 'reminderDays' && Array.isArray(v)) return v.length ? `${v.join(', ')} day${v.length === 1 && v[0] === 1 ? '' : 's'} before` : 'No day-before reminders';
  if (key === 'dismissedInsights' && Array.isArray(v)) return `${v.length} dismissed`;
  if (key === 'sampleIds' && Array.isArray(v)) return `${v.length} row${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

/** Deep equality for the plain JSON values settings hold. */
export function sameSetting(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => sameSetting((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
