export interface CurrencyInfo { code: string; name: string }

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'INR', name: 'Indian Rupee' }, { code: 'USD', name: 'US Dollar' }, { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British Pound' }, { code: 'JPY', name: 'Japanese Yen' }, { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CAD', name: 'Canadian Dollar' }, { code: 'CHF', name: 'Swiss Franc' }, { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'SGD', name: 'Singapore Dollar' }, { code: 'AED', name: 'UAE Dirham' }, { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'HKD', name: 'Hong Kong Dollar' }, { code: 'NZD', name: 'New Zealand Dollar' }, { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' }, { code: 'DKK', name: 'Danish Krone' }, { code: 'ZAR', name: 'South African Rand' },
  { code: 'BRL', name: 'Brazilian Real' }, { code: 'MXN', name: 'Mexican Peso' }, { code: 'KRW', name: 'South Korean Won' },
  { code: 'PLN', name: 'Polish Zloty' },
];
export const DEFAULT_BASE = 'INR';
const CODES = new Set(CURRENCIES.map(c => c.code));

export const isCurrencyCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c);

/** Manual rates: units of the base currency per 1 unit of the key currency. */
export type Rates = Record<string, number>;

export const isValidRate = (r: unknown): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0;

/** Keep only well-formed entries; used when reading settings that came from storage or a backup. */
export function sanitizeRates(raw: unknown): Rates {
  const out: Rates = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (isCurrencyCode(k) && isValidRate(v)) out[k] = v;
  return out;
}

/**
 * Convert into the base currency. Returns null when the currency differs from the base and no valid
 * rate is set, so callers must handle it explicitly instead of silently treating the rate as 1.
 */
export function convert(amount: number, from: string, base: string, rates: Rates): number | null {
  if (from === base) return amount;
  const r = rates[from];
  return isValidRate(r) ? amount * r : null;
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const SYMBOLS: [RegExp, string][] = [
  [/\bUS\$|^\s*-?\s*\$(?!\w)|\$\s*-?\d|\d\s*\$/, 'USD'],
  [/\b(?:A\$|AU\$)/, 'AUD'], [/\b(?:C\$|CA\$)/, 'CAD'], [/\bS\$/, 'SGD'], [/\bHK\$/, 'HKD'], [/\bNZ\$/, 'NZD'],
  [/€/, 'EUR'], [/£/, 'GBP'], [/₹|\bRs\.?(?=\s|\d|$)/i, 'INR'], [/¥/, 'JPY'], [/₩/, 'KRW'],
];

/** Currency named in an amount cell ("$12.99", "EUR 12,99", "Rs. 299", "299 INR"), or undefined when none is shown. */
export function detectCurrency(raw: string): string | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const code = s.toUpperCase().match(/\b[A-Z]{3}\b/g)?.find(c => CODES.has(c));
  if (code) return code;
  // check the prefixed dollar variants before the bare "$"
  const ordered = [...SYMBOLS.slice(1, 6), SYMBOLS[0], ...SYMBOLS.slice(6)];
  return ordered.find(([re]) => re.test(s))?.[1];
}
