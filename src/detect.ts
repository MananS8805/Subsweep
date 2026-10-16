import type { Cycle, Detected } from './types';
import { parseStatementDetailed, type Txn } from './csvFormats';
import { dayDiff, localDate } from './dates';

export type { Txn, ParsedStatement } from './csvFormats';
export { parseDate, parseAmount, parseStatementDetailed } from './csvFormats';

const toDate = (s: string) => new Date(s + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Parse a bank CSV into debit transactions (see parseStatementDetailed for the skipped-row count). */
export const parseStatement = (csv: string): Txn[] => parseStatementDetailed(csv).txns;

const NOISE = /\b(pos|debit|card|purchase|payment|recurring|online|checkcard|visa|mastercard|www|http|https|com|inc|llc|ltd|co|pmt|ach|sq|tst|paypal|pp|upi|neft|imps|rtgs|nach|ecom|autopay|prepaid|mandate)\b/g;
export function normalizeMerchant(desc: string): string {
  return desc.toLowerCase()
    .replace(/[*#_\-.,/\\()]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\b\d[\w]*\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .split(' ')[0] ?? '';
}
const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

// ---- cycles ---------------------------------------------------------------------------------------------

/** Allowed gap (in days) between charges for each cycle: weekly 7±1, biweekly 14±2, monthly 28-31±3, quarterly 90±6, yearly 365±10. */
export const CYCLE_BANDS: Record<Cycle, [number, number]> = {
  weekly: [6, 8], biweekly: [12, 16], monthly: [25, 34], quarterly: [84, 96], yearly: [355, 375],
};
export function classify(gapDays: number): Cycle | null {
  for (const [cycle, [lo, hi]] of Object.entries(CYCLE_BANDS) as [Cycle, [number, number]][]) if (gapDays >= lo && gapDays <= hi) return cycle;
  return null;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const stdev = (a: number[]) => { const m = a.reduce((t, x) => t + x, 0) / a.length; return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / a.length); };

export function addCycle(dateIso: string, cycle: Cycle, n = 1): string {
  const d = toDate(dateIso);
  if (cycle === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (cycle === 'biweekly') d.setUTCDate(d.getUTCDate() + 14 * n);
  else {
    const months = cycle === 'monthly' ? 1 : cycle === 'quarterly' ? 3 : 12;
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months * n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return iso(d);
}

/** Roll a renewal date forward until it is on/after `today`. */
export function nextOnOrAfter(dateIso: string, cycle: Cycle, today = localDate()): string {
  let d = dateIso, guard = 0;
  while (d < today && guard++ < 500) d = addCycle(d, cycle);
  return d;
}

export const monthlyCost = (amount: number, cycle: Cycle) =>
  cycle === 'weekly' ? amount * 52 / 12
    : cycle === 'biweekly' ? amount * 26 / 12
      : cycle === 'monthly' ? amount
        : cycle === 'quarterly' ? amount / 3
          : amount / 12;

// ---- price history ---------------------------------------------------------------------------------------

/** Within this fraction of a run's first amount counts as "the same price" (tax rounding, FX wobble). */
export const SAME_PRICE = 0.05;

/** Consecutive charges at (about) the same price form a run; each run is one entry of price history. */
export function priceRuns(series: { date: string; amount: number }[]): { date: string; amount: number }[] {
  const runs: { date: string; amount: number }[] = [];
  for (const t of series) {
    const cur = runs[runs.length - 1];
    if (!cur || Math.abs(t.amount - cur.amount) > cur.amount * SAME_PRICE) runs.push({ date: t.date, amount: t.amount });
  }
  return runs;
}

/** The "price crept up" flag, derived from the price history: first price vs latest, when it rose by more than 3%. */
export function creepFromHistory(history: { amount: number }[]): { from: number; to: number } | null {
  if (history.length < 2) return null;
  const from = history[0].amount, to = history[history.length - 1].amount;
  return to > from * 1.03 ? { from, to } : null;
}

// ---- confidence ------------------------------------------------------------------------------------------

export type ConfidenceLabel = 'High' | 'Medium' | 'Low';
export const confidenceLabel = (c: number): ConfidenceLabel => (c >= 0.75 ? 'High' : c >= 0.5 ? 'Medium' : 'Low');

const NOMINAL: Record<Cycle, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
// how much the gaps may wobble (standard deviation, days) before regularity drops to zero
const SPREAD: Record<Cycle, number> = { weekly: 3, biweekly: 5, monthly: 6, quarterly: 15, yearly: 30 };
// how many repeats count as full evidence: a monthly charge needs ~5 sightings, a yearly one only 3
const STEPS: Record<Cycle, number> = { weekly: 6, biweekly: 4, monthly: 4, quarterly: 3, yearly: 2 };
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

export interface ConfidenceInput { cycle: Cycle; occurrences: number; gaps: number[]; priceRunCount: number; daysSinceLast: number }

/**
 * 0..1 score from four signals: how many times it repeated (30%), how regular the gaps are (25%), how consistent
 * the amount is, where a clean step to a new price still counts (30%), and whether the last charge is recent (15%).
 * Hard caps keep thin or erratic evidence out of High: erratic amounts are Low, a yearly charge seen twice tops out
 * at Medium, and two weekly/biweekly sightings are Low (two coffees a week apart are not a subscription).
 */
export function scoreConfidence(i: ConfidenceInput): number {
  const n = i.occurrences;
  const occ = clamp((n - 1) / STEPS[i.cycle]);
  const reg = i.gaps.length < 2 ? 0.7 : 1 - clamp(stdev(i.gaps) / SPREAD[i.cycle]);
  const changes = i.priceRunCount - 1;
  const amt = changes === 0 ? 1 : changes <= Math.floor(n / 3) ? 0.85 : clamp(1 - changes / (n - 1));
  const limit = 1.5 * NOMINAL[i.cycle];
  const rec = i.daysSinceLast <= limit ? 1 : clamp(1 - (i.daysSinceLast - limit) / (1.5 * NOMINAL[i.cycle]));
  let score = 0.30 * occ + 0.25 * reg + 0.30 * amt + 0.15 * rec;
  if (amt < 0.5) score = Math.min(score, 0.45);
  if (i.cycle === 'yearly' && n < 3) score = Math.min(score, 0.70);
  if ((i.cycle === 'weekly' || i.cycle === 'biweekly') && n < 3) score = Math.min(score, 0.49);
  return Math.round(score * 100) / 100;
}

// ---- detection ---------------------------------------------------------------------------------------------

/** Identical charges on the same day are one occurrence (a double-posted row), not two. */
function dedupeSameDay(list: Txn[]): Txn[] {
  const seen = new Set<string>();
  return list.filter(t => { const k = `${t.date}|${t.amount.toFixed(2)}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** If one merchant has two DIFFERENT charges on the same day it is really several things (say two plans), so split by amount. */
function splitSeries(list: Txn[]): Txn[][] {
  const days = new Set<string>();
  const clash = list.some(t => (days.has(t.date) ? true : (days.add(t.date), false)));
  if (!clash) return [list];
  const byAmount = [...list].sort((a, b) => a.amount - b.amount);
  const clusters: Txn[][] = [];
  for (const t of byAmount) {
    const cur = clusters[clusters.length - 1];
    if (cur && t.amount <= cur[0].amount * (1 + SAME_PRICE)) cur.push(t); else clusters.push([t]);
  }
  return clusters.map(c => { const seen = new Set<string>(); return c.filter(t => (seen.has(t.date) ? false : (seen.add(t.date), true))); });
}

function analyze(key: string, list: Txn[], today: string): Detected | null {
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return null; // one-off purchases are never subscriptions
  const gaps = sorted.slice(1).map((t, i) => dayDiff(sorted[i].date, t.date)).filter(g => g > 0);
  if (!gaps.length) return null;
  const cycle = classify(median(gaps));
  if (!cycle) return null;
  // at least ~60% of gaps must agree with the cycle (tolerates a missed or extra row)
  if (gaps.filter(g => classify(g) === cycle).length / gaps.length < 0.6) return null;
  const amounts = sorted.map(t => t.amount);
  if (Math.max(...amounts) / Math.min(...amounts) > 2) return null; // not the same plan at a different price
  const history = priceRuns(sorted);
  const last = sorted[sorted.length - 1];
  const confidence = scoreConfidence({
    cycle, occurrences: sorted.length, gaps, priceRunCount: history.length, daysSinceLast: dayDiff(last.date, today),
  });
  return {
    name: titleCase(key), amount: last.amount, cycle, firstDate: sorted[0].date, lastDate: last.date, occurrences: sorted.length,
    currency: [...sorted].reverse().find(t => t.currency)?.currency,
    nextRenewal: nextOnOrAfter(addCycle(last.date, cycle), cycle, today),
    priceHistory: history, priceCreep: creepFromHistory(history), confidence,
  };
}

/**
 * Find recurring charges in a statement. Each result carries its cycle (weekly to yearly), a 0..1 confidence,
 * its price history, and a next renewal. Most confident first.
 */
export function detectRecurring(txns: Txn[], today = localDate()): Detected[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    const key = normalizeMerchant(t.desc);
    if (key.length < 2) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: Detected[] = [];
  for (const [key, list] of groups) {
    for (const series of splitSeries(dedupeSameDay(list))) {
      const found = analyze(key, series, today);
      if (found) out.push(found);
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence || monthlyCost(b.amount, b.cycle) - monthlyCost(a.amount, a.cycle));
}
