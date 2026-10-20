import type { Rates } from './currency';
import { monthlyBase } from './savings';
import { isLive, type Subscription } from './types';

export const METHOD_MAX = 40;
export const METHOD_HINT = 'Use a nickname like Visa ending 4242, not the full number.';

/** Trim, collapse runs of spaces and cap the length. Returns '' for nothing. */
export const normalizeLabel = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, METHOD_MAX).trim() : '';

/** Case-insensitive identity of a label: "Visa 4242" and "visa 4242 " are the same one. */
export const labelKey = (raw: unknown): string => normalizeLabel(raw).toLowerCase();

/** 13 to 19 digits (with spaces or dashes between them) and nothing else: that is a card number, not a nickname. */
export function looksLikeCardNumber(raw: string): boolean {
  const t = raw.trim();
  if (!/^[\d\s-]+$/.test(t)) return false;
  const digits = t.replace(/\D/g, '').length;
  return digits >= 13 && digits <= 19;
}

/** A plain sentence describing why a label cannot be saved, or null. Checked before trimming to the length limit. */
export function validateLabel(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (looksLikeCardNumber(t)) return `That looks like a card number, so it was not saved. ${METHOD_HINT}`;
  if (t.length > METHOD_MAX) return `Payment method can be at most ${METHOD_MAX} characters.`;
  return null;
}

/** The label to store: if the same label (ignoring case) is already used somewhere, reuse its first-seen casing. */
export function canonicalLabel(raw: string, subs: Subscription[]): string {
  const n = normalizeLabel(raw);
  if (!n) return '';
  const k = n.toLowerCase();
  for (const s of subs) { const l = normalizeLabel(s.paymentMethod); if (l && l.toLowerCase() === k) return l; }
  return n;
}

export interface MethodCount { label: string; count: number }

/** Distinct labels in use (first-seen casing), most used first, then alphabetical. */
export function listMethods(subs: Subscription[]): MethodCount[] {
  const seen = new Map<string, MethodCount>();
  for (const s of subs) {
    const l = normalizeLabel(s.paymentMethod);
    if (!l) continue;
    const k = l.toLowerCase();
    const row = seen.get(k);
    if (row) row.count++; else seen.set(k, { label: l, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
}

/** Does this subscription pass the payment-method filter? 'all' = no filter, 'none' = unlabelled, otherwise a label. */
export function matchesMethod(s: Subscription, filter: string): boolean {
  if (filter === 'all') return true;
  const l = labelKey(s.paymentMethod);
  return filter === 'none' ? l === '' : l === filter.toLowerCase();
}

export interface MethodTotal { label: string | null; count: number; monthly: number; rateNeeded: number }

/**
 * Monthly cost per payment method in the base currency, for subscriptions you still pay for. A subscription whose currency
 * has no exchange rate is counted in `count` and `rateNeeded` but adds nothing to `monthly`. Unlabelled ones form a final
 * `label: null` row. Rows are ordered by monthly cost, biggest first.
 */
export function totalsByMethod(subs: Subscription[], settings: { baseCurrency: string; rates: Rates }): MethodTotal[] {
  const rows = new Map<string, MethodTotal>();
  for (const s of subs.filter(isLive)) {
    const l = normalizeLabel(s.paymentMethod);
    const k = l.toLowerCase();
    let row = rows.get(k);
    if (!row) { row = { label: l || null, count: 0, monthly: 0, rateNeeded: 0 }; rows.set(k, row); }
    row.count++;
    const m = monthlyBase(s, settings.baseCurrency, settings.rates);
    if (m === null) row.rateNeeded++; else row.monthly += m;
  }
  const all = [...rows.values()];
  return [...all.filter(r => r.label !== null).sort((a, b) => b.monthly - a.monthly || a.label!.toLowerCase().localeCompare(b.label!.toLowerCase())), ...all.filter(r => r.label === null)];
}
