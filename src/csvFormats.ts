import Papa from 'papaparse';

export interface Txn { date: string; desc: string; amount: number }
export interface ParsedStatement { txns: Txn[]; skippedRows: number }
export type DateOrder = 'dmy' | 'mdy';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;
const NUMERIC = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/;
const DAY_MON_YEAR = /^(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*\.?,?[\s-]+(\d{4}|\d{2})(?!\d)/;
const MON_DAY_YEAR = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/;
const fullYear = (y: string) => (y.length === 2 ? 2000 + +y : +y);

/**
 * Decide whether ambiguous numeric dates (both parts <= 12) are day-first or month-first.
 * Any value with a part above 12 settles it for the whole file; the default is day-first.
 */
export function inferDateOrder(raws: string[]): DateOrder {
  let dayFirst = 0, monthFirst = 0;
  for (const raw of raws) {
    const m = raw.trim().match(NUMERIC);
    if (!m) continue;
    if (+m[1] > 12) dayFirst++;
    else if (+m[2] > 12) monthFirst++;
  }
  return monthFirst > dayFirst ? 'mdy' : 'dmy';
}

/** YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD MMM YYYY (and MMM DD, YYYY). Returns ISO or null. */
export function parseDate(raw: string, order: DateOrder = 'dmy'): string | null {
  const s = raw.trim();
  let m = s.match(ISO);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(NUMERIC);
  if (m) {
    const a = +m[1], b = +m[2], y = fullYear(m[3]);
    if (a > 12) return ymd(y, b, a);
    if (b > 12) return ymd(y, a, b);
    return order === 'dmy' ? ymd(y, b, a) : ymd(y, a, b);
  }
  m = s.match(DAY_MON_YEAR);
  if (m) {
    const mon = MONTHS.indexOf(m[2].toLowerCase());
    return mon < 0 ? null : ymd(fullYear(m[3]), mon + 1, +m[1]);
  }
  m = s.match(MON_DAY_YEAR);
  if (m) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    return mon < 0 ? null : ymd(+m[3], mon + 1, +m[2]);
  }
  return null;
}

/**
 * Signed amount from "1,234.56", "1.234,56", "12,99", "(15.49)", "$-15.49", "15.49-", "299.00 Dr".
 * Negative = outflow marker (minus, parentheses, trailing minus, Dr suffix); a Cr suffix is positive.
 */
export function parseAmount(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const orig = String(raw).trim();
  if (!orig) return null;
  const credit = /CR\.?$/i.test(orig);
  const neg = !credit && (/^\(.*\)$/.test(orig) || /^[^\d]*[-−–]\s*\d/.test(orig) || /\d\s*[-−–]$/.test(orig) || /DR\.?$/i.test(orig));
  let s = orig.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimalComma = s.split(',').length === 2 && s.length - lastComma - 1 !== 3;
    s = decimalComma ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -Math.abs(n) : n;
}

// ---- header normalization -------------------------------------------------

type Role = 'date' | 'indicator' | 'debit' | 'credit' | 'amount' | 'desc';
const ROLE_PATTERNS: [Role, RegExp][] = [
  ['date', /date|^posted$|^posting$/],
  ['indicator', /^(dr\s*[/\\]\s*cr|cr\s*[/\\]\s*dr|debit\s*[/\\]\s*credit|credit\s*[/\\]\s*debit|d\s*[/\\]\s*c|type|txn type|transaction type)$/],
  ['debit', /^(dr|(debit|withdrawal)s?( amt\.?| amount)?|paid out|money out)$/],
  ['credit', /^(cr|(credit|deposit)s?( amt\.?| amount)?|paid in|money in)$/],
  ['amount', /^(amount|amt|transaction amount|txn amount|value)$/],
  ['desc', /description|narration|narrative|details|merchant|payee|particulars|memo|remarks|^name$/],
];
// Preferred date column when a statement has several (e.g. Transaction Date + Value Date).
const DATE_PREFERENCE = ['transaction date', 'txn date', 'trans date', 'date', 'posting date', 'posted date', 'booking date', 'value date'];

const clean = (h: string) => h.replace(/^﻿/, '').replace(/["']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

interface Columns { date: number; desc: number; debit: number; credit: number; amount: number; indicator: number }

function mapHeader(cells: string[]): Columns {
  const cols: Columns = { date: -1, desc: -1, debit: -1, credit: -1, amount: -1, indicator: -1 };
  const names = cells.map(clean);
  cols.date = DATE_PREFERENCE.map(p => names.indexOf(p)).find(i => i >= 0) ?? -1;
  names.forEach((name, i) => {
    if (!name || i === cols.date) return;
    const role = ROLE_PATTERNS.find(([, re]) => re.test(name))?.[0];
    if (!role || role === 'date') return;
    if (cols[role] < 0) cols[role] = i;
  });
  if (cols.date < 0) cols.date = names.findIndex(n => ROLE_PATTERNS[0][1].test(n));
  return cols;
}

const hasAmount = (c: Columns) => c.amount >= 0 || c.debit >= 0 || c.credit >= 0;

function findHeader(rows: string[][]): { index: number; cols: Columns } | null {
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const cols = mapHeader(rows[i]);
    if (cols.date >= 0 && cols.desc >= 0 && hasAmount(cols)) return { index: i, cols };
  }
  return null;
}

const DR = /^(dr\.?|debit|d)$/i;
const CR = /^(cr\.?|credit|c)$/i;

/**
 * Parse a bank CSV (any common layout) into debit transactions. Runs fully in the browser.
 * Rows that look like data but cannot be parsed are counted in `skippedRows`; blank lines and
 * one-cell junk (titles, "End of statement") are ignored silently.
 */
export function parseStatementDetailed(csv: string): ParsedStatement {
  const text = csv.replace(/^﻿/, '');
  let found: { rows: string[][]; index: number; cols: Columns } | null = null;
  for (const delimiter of [',', ';', '\t', '|']) {
    const rows = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: 'greedy' }).data;
    const h = findHeader(rows);
    if (h) { found = { rows, ...h }; break; }
  }
  if (!found) {
    throw new Error('Could not find date, description and amount columns in this CSV. Expected headers such as Date, Description and Amount (or Debit/Credit).');
  }

  const { cols } = found;
  const data = found.rows.slice(found.index + 1).filter(r => r.filter(c => c.trim()).length >= 2);
  const cell = (r: string[], i: number) => (i >= 0 ? r[i] ?? '' : '');
  const order = inferDateOrder(data.map(r => cell(r, cols.date)));

  const split = cols.debit >= 0 || cols.credit >= 0;
  const indicatorValues = cols.indicator >= 0 ? data.map(r => cell(r, cols.indicator).trim()).filter(Boolean) : [];
  const useIndicator = !split && cols.amount >= 0 && indicatorValues.length > 0
    && indicatorValues.filter(v => DR.test(v) || CR.test(v)).length >= indicatorValues.length * 0.5;

  type Row = { date: string; desc: string; amount: number; signed: boolean; outflow: boolean };
  const rows: Row[] = [];
  let skippedRows = 0;
  for (const r of data) {
    const date = parseDate(cell(r, cols.date), order);
    const desc = cell(r, cols.desc).trim();
    if (!date || !desc) { skippedRows++; continue; }
    if (split) {
      const debit = cols.debit >= 0 ? parseAmount(cell(r, cols.debit)) : null;
      const credit = cols.credit >= 0 ? parseAmount(cell(r, cols.credit)) : null;
      if (debit === null && credit === null) { skippedRows++; continue; }
      rows.push({ date, desc, amount: Math.abs(debit ?? 0), signed: false, outflow: debit !== null && debit !== 0 });
      continue;
    }
    const amt = parseAmount(cell(r, cols.amount));
    if (amt === null) { skippedRows++; continue; }
    if (useIndicator) {
      const ind = cell(r, cols.indicator).trim();
      if (!DR.test(ind) && !CR.test(ind)) { skippedRows++; continue; }
      rows.push({ date, desc, amount: Math.abs(amt), signed: false, outflow: DR.test(ind) && amt !== 0 });
    } else {
      rows.push({ date, desc, amount: amt, signed: true, outflow: false });
    }
  }

  // Single signed column: if many values are negative, debits are negative; otherwise debits are positive.
  const signedRows = rows.filter(r => r.signed);
  const debitsAreNegative = signedRows.filter(r => r.amount < 0).length > signedRows.length * 0.3;
  const txns: Txn[] = [];
  for (const r of rows) {
    const outflow = r.signed ? (debitsAreNegative ? r.amount < 0 : r.amount > 0) : r.outflow;
    if (outflow) txns.push({ date: r.date, desc: r.desc, amount: Math.abs(r.amount) });
  }
  return { txns, skippedRows };
}
