import Papa from 'papaparse';
import type { Cycle, Detected } from './types';

export interface Txn { date: string; desc: string; amount: number }

const DAY = 86400000;
const toDate = (s: string) => new Date(s + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = '20' + y;
    let month = +a, day = +b;
    if (month > 12) [month, day] = [day, month]; // DD/MM/YYYY
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(+d) ? null : iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

function parseAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let s = String(raw).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-') || /DR$/i.test(s);
  s = s.replace(/[^0-9.,-]/g, '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** Parse a bank CSV (any common layout) into debit transactions. Runs fully in the browser. */
export function parseStatement(csv: string): Txn[] {
  const res = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: h => h.trim().toLowerCase() });
  const fields = res.meta.fields ?? [];
  const find = (...keys: string[]) => fields.find(f => keys.some(k => f.includes(k)));
  const dateF = find('date', 'posted');
  const descF = find('description', 'merchant', 'payee', 'details', 'name', 'memo', 'narrative');
  const debitF = find('debit', 'withdrawal', 'paid out');
  const amountF = find('amount', 'value');
  if (!dateF || !descF || !(debitF || amountF)) throw new Error('Could not find date, description and amount columns in this CSV.');

  const rows = res.data.map(r => {
    const date = parseDate(r[dateF] ?? '');
    let amt = debitF ? parseAmount(r[debitF]) : parseAmount(r[amountF!]);
    return { date, desc: (r[descF] ?? '').trim(), amt };
  }).filter(r => r.date && r.desc && r.amt !== null) as { date: string; desc: string; amt: number }[];

  const negatives = rows.filter(r => r.amt < 0).length;
  const debitsAreNegative = !debitF && negatives > rows.length * 0.3;
  return rows
    .filter(r => (debitF ? r.amt !== 0 : debitsAreNegative ? r.amt < 0 : r.amt > 0))
    .map(r => ({ date: r.date, desc: r.desc, amount: Math.abs(r.amt) }));
}

const NOISE = /\b(pos|debit|card|purchase|payment|recurring|online|checkcard|visa|mastercard|www|http|https|com|inc|llc|ltd|co|pmt|ach|sq|tst|paypal|pp)\b/g;
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
      nextRenewal: nextOnOrAfter(addCycle(lastDate, cycle), cycle, today), priceCreep: creep,
    });
  }
  return out.sort((a, b) => monthlyCost(b.amount, b.cycle) - monthlyCost(a.amount, a.cycle));
}

export const monthlyCost = (amount: number, cycle: Cycle) =>
  cycle === 'weekly' ? amount * 52 / 12 : cycle === 'monthly' ? amount : cycle === 'quarterly' ? amount / 3 : amount / 12;
