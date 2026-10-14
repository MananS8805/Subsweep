import { isLive, type Subscription } from './types';
import { monthlyCost } from './detect';
import { convert, type Rates } from './currency';

export const subCurrency = (s: Subscription, base: string) => s.currency ?? base;

/** Monthly cost in the base currency, or null when the exchange rate is missing. Free trials cost nothing. */
export function monthlyBase(s: Subscription, base: string, rates: Rates): number | null {
  if (s.isTrial) return 0;
  return convert(monthlyCost(s.amount, s.cycle), subCurrency(s, base), base, rates);
}

export function yearlyCost(s: Subscription, base: string, rates: Rates): number | null {
  const m = monthlyBase(s, base, rates);
  return m === null ? null : m * 12;
}

/** Distinct currencies (other than the base) that have no usable rate yet. */
export const missingCurrencies = (subs: Subscription[], base: string, rates: Rates): string[] =>
  [...new Set(subs.filter(s => monthlyBase(s, base, rates) === null).map(s => subCurrency(s, base)))].sort();

export interface Totals { monthly: number; yearly: number; missing: Subscription[] }

/** Totals over the subscriptions you still pay for. Items without a rate are left out and listed in `missing`. */
export function totals(subs: Subscription[], base: string, rates: Rates): Totals {
  let monthly = 0;
  const missing: Subscription[] = [];
  for (const s of subs.filter(isLive)) {
    const m = monthlyBase(s, base, rates);
    if (m === null) missing.push(s); else monthly += m;
  }
  return { monthly, yearly: monthly * 12, missing };
}

export function categoryYearly(subs: Subscription[], base: string, rates: Rates): [string, number][] {
  const m = new Map<string, number>();
  for (const s of subs.filter(isLive)) {
    const y = yearlyCost(s, base, rates);
    if (y !== null && y > 0) m.set(s.category, (m.get(s.category) ?? 0) + y);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export interface Savings { count: number; monthly: number; yearly: number; fiveYear: number; missing: Subscription[] }

/** What cancelling the selected subscriptions would save (a flat projection: no price changes assumed). */
export function savingsFor(subs: Subscription[], selected: Iterable<number>, base: string, rates: Rates): Savings {
  const ids = new Set(selected);
  const picked = subs.filter(s => s.id !== undefined && ids.has(s.id) && isLive(s));
  const t = totals(picked, base, rates);
  return { count: picked.length, monthly: t.monthly, yearly: t.yearly, fiveYear: t.yearly * 5, missing: t.missing };
}
