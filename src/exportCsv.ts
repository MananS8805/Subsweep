import type { Digest } from './digest';
import { weekStart } from './digest';
import type { Rates } from './currency';
import { monthlyBase, yearlyCost } from './savings';
import { normalizeLabel } from './paymentMethods';
import { isSample } from './onboarding';
import type { Subscription } from './types';

export const BOM = '﻿';
const EOL = '\r\n';

/** A text cell: neutralise spreadsheet formulas, then quote per RFC 4180 when needed. */
export function textCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** A numeric cell: never prefixed (a negative number is still a number). Blank for null. */
export const moneyCell = (n: number | null | undefined): string => (n === null || n === undefined || !Number.isFinite(n) ? '' : n.toFixed(2));

const line = (cells: string[]) => cells.join(',') + EOL;

export const SUBSCRIPTION_COLUMNS = ['name', 'category', 'amount', 'currency', 'cycle', 'next_renewal', 'monthly_base', 'yearly_base', 'base_currency', 'payment_method', 'trial', 'cancel_flag', 'muted', 'last_reviewed', 'notes'] as const;
export const DIGEST_COLUMNS = ['date', 'name', 'amount_base', 'base_currency', 'week_start', 'status'] as const;

export interface CsvSettings { baseCurrency: string; rates: Rates }

/** Every subscription (sample data excluded) as CSV text with a UTF-8 byte order mark so Excel reads non-ASCII names. */
export function subscriptionsToCsv(subs: Subscription[], settings: CsvSettings): string {
  const base = settings.baseCurrency;
  let out = BOM + line([...SUBSCRIPTION_COLUMNS]);
  for (const s of subs.filter(x => !isSample(x))) {
    out += line([
      textCell(s.name), textCell(s.category), moneyCell(s.amount), textCell(s.currency ?? base), textCell(s.cycle), textCell(s.nextRenewal),
      moneyCell(monthlyBase({ ...s, isTrial: false }, base, settings.rates)), moneyCell(yearlyCost({ ...s, isTrial: false }, base, settings.rates)), textCell(base),
      textCell(normalizeLabel(s.paymentMethod)), s.isTrial ? 'yes' : 'no', s.selectedForCancel ? 'yes' : 'no', s.muted ? 'yes' : 'no',
      textCell(s.lastReviewedAt ?? ''), textCell(s.notes ?? ''),
    ]);
  }
  return out;
}

/** The Next 30 days payments as CSV, one row per payment, plus trial ends and charges that need an exchange rate. */
export function digestToCsv(d: Digest, subs: Subscription[], baseCurrency: string): string {
  const name = (id: number) => subs.find(s => s.id === id)?.name ?? 'Subscription';
  let out = BOM + line([...DIGEST_COLUMNS]);
  for (const p of d.payments) {
    out += line([p.date, textCell(name(p.subId)), moneyCell(p.amountBase), textCell(baseCurrency), weekStart(p.date), p.muted || p.snoozed ? 'muted' : 'normal']);
  }
  for (const t of d.trialsEnding) out += line([t.date, textCell(name(t.subId)), '', textCell(baseCurrency), weekStart(t.date), 'trial']);
  for (const r of d.rateNeeded) {
    const s = subs.find(x => x.id === r.subId);
    out += line([s?.nextRenewal ?? '', textCell(name(r.subId)), '', textCell(baseCurrency), s ? weekStart(s.nextRenewal) : '', 'rate_needed']);
  }
  return out;
}

export const hasDataRows = (csv: string): boolean => csv.replace(BOM, '').split(EOL).filter(Boolean).length > 1;

/** subsweep-subscriptions-2026-10-20.csv, using the LOCAL date. */
export function csvFileName(kind: 'subscriptions' | 'next30', localDate: string): string {
  return `subsweep-${kind}-${localDate}.csv`;
}
