import type { Cycle, Detected } from './types';
import { parseStatementDetailed, type Txn } from './csvFormats';

export type { Txn, ParsedStatement } from './csvFormats';
export { parseDate, parseAmount, parseStatementDetailed } from './csvFormats';

const DAY = 86400000;
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

function classify(medianGap: number): Cycle | null {
  if (medianGap >= 6 && medianGap <= 8) return 'weekly';
  if (medianGap >= 26 && medianGap <= 35) return 'monthly';
  if (medianGap >= 84 && medianGap <= 97) return 'quarterly';
  if (medianGap >= 350 && medianGap <= 380) return 'yearly';
  return null;
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function addCycle(dateIso: string, cycle: Cycle, n = 1): string {
  const d = toDate(dateIso);
  if (cycle === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * n);
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
export function nextOnOrAfter(dateIso: string, cycle: Cycle, today = iso(new Date())): string {
  let d = dateIso, guard = 0;
  while (d < today && guard++ < 500) d = addCycle(d, cycle);
  return d;
}

export function detectRecurring(txns: Txn[], today = iso(new Date())): Detected[] {
  const groups = new Map<string, Txn[]>();
  for (const t of txns) {
    const key = normalizeMerchant(t.desc);
    if (key.length < 2) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: Detected[] = [];
  for (const [key, list] of groups) {
    // one charge per day per merchant
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) continue;
    const gaps = sorted.slice(1).map((t, i) => (+toDate(t.date) - +toDate(sorted[i].date)) / DAY).filter(g => g > 0);
    if (!gaps.length) continue;
    const cycle = classify(median(gaps));
    if (!cycle) continue;
    // at least ~60% of gaps must agree with the cycle (tolerates a missed/extra row)
    const ok = gaps.filter(g => classify(g) === cycle).length;
    if (ok / gaps.length < 0.6) continue;
    // amounts must be broadly stable (allow price changes up to 40%)
    const amts = sorted.map(t => t.amount);
    const first = amts[0], last = amts[amts.length - 1];
    if (Math.max(...amts) / Math.min(...amts) > 1.6) continue;
    const lastDate = sorted[sorted.length - 1].date;
    const creep = last > first * 1.03 ? { from: first, to: last } : null;
    out.push({
      name: titleCase(key), amount: last, cycle, lastDate, occurrences: sorted.length,
      currency: [...sorted].reverse().find(t => t.currency)?.currency,
      nextRenewal: nextOnOrAfter(addCycle(lastDate, cycle), cycle, today), priceCreep: creep,
    });
  }
  return out.sort((a, b) => monthlyCost(b.amount, b.cycle) - monthlyCost(a.amount, a.cycle));
}

export const monthlyCost = (amount: number, cycle: Cycle) =>
  cycle === 'weekly' ? amount * 52 / 12 : cycle === 'monthly' ? amount : cycle === 'quarterly' ? amount / 3 : amount / 12;
