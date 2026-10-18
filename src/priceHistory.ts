import { formatMoney } from './currency';
import { dayDiff } from './dates';

export interface PricePoint { date: string; amount: number; kind: 'start' | 'up' | 'down' }

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Clean a price history for display: valid dates and positive amounts only, entries dated after `now` dropped (a typo
 * should not draw into the future), sorted oldest first, and repeats of the same price collapsed so every point is a real
 * change. Each point records whether the price went up or down from the one before.
 */
export function buildSeries(history: { date: string; amount: number }[] | undefined, now: string): PricePoint[] {
  const clean = (history ?? [])
    .filter(h => ISO.test(h.date) && Number.isFinite(h.amount) && h.amount > 0 && h.date <= now)
    .map((h, i) => ({ ...h, i }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
  const out: PricePoint[] = [];
  for (const h of clean) {
    const prev = out[out.length - 1];
    if (prev && prev.amount === h.amount) continue;
    out.push({ date: h.date, amount: h.amount, kind: !prev ? 'start' : h.amount > prev.amount ? 'up' : 'down' });
  }
  return out;
}

export interface PriceSummary {
  kind: 'none' | 'flat' | 'up' | 'down';
  text: string;
  from?: number;
  to?: number;
  percent?: number;     // rounded, signed
  changes: number;      // how many times the price changed
}

const monthYear = (iso: string, locale?: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** One sentence about the price: "Rose from ₹499.00 to ₹649.00 (+30%) since Mar 2026". */
export function summarize(history: { date: string; amount: number }[] | undefined, currency: string, now = '9999-12-31', locale?: string): PriceSummary {
  const s = buildSeries(history, now);
  if (s.length < 2) return { kind: 'none', text: 'No price changes recorded', changes: 0 };
  const first = s[0], last = s[s.length - 1];
  const changes = s.length - 1;
  const percent = Math.round(((last.amount - first.amount) / first.amount) * 100);
  const since = monthYear(first.date, locale);
  const [from, to] = [formatMoney(first.amount, currency), formatMoney(last.amount, currency)];
  if (last.amount === first.amount) return { kind: 'flat', text: `Changed ${changes} times and is back to ${to} since ${since}`, from: first.amount, to: last.amount, percent: 0, changes };
  const up = last.amount > first.amount;
  const pct = `${up ? '+' : '−'}${Math.abs(percent)}%`;
  return { kind: up ? 'up' : 'down', text: `${up ? 'Rose' : 'Fell'} from ${from} to ${to} (${pct}) since ${since}`, from: first.amount, to: last.amount, percent, changes };
}

// ---- chart geometry (pure, so it can be tested without a browser) ------------------------------------------------

export interface LabelBox { x: number; y: number; w: number; h: number; text: string; anchor: 'start' | 'middle' | 'end' }
export interface ChartLayout {
  width: number; height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  path: string;                                   // the step line
  markers: { x: number; y: number; kind: PricePoint['kind']; shape: string }[];
  yTicks: { y: number; label: LabelBox }[];
  xLabels: LabelBox[];
  yMax: number;
}

/** A round number at or above `v` from the 1-2-5 series, so axis ticks read cleanly. */
export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

const GLYPH_W = 6.4;   // average character width at the chart's font size, in SVG units
const GLYPH_H = 12;

/** Whether two label boxes overlap (used by the layout and by tests). */
export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  const ax = a.anchor === 'start' ? a.x : a.anchor === 'end' ? a.x - a.w : a.x - a.w / 2;
  const bx = b.anchor === 'start' ? b.x : b.anchor === 'end' ? b.x - b.w : b.x - b.w / 2;
  return ax < bx + b.w && bx < ax + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Lay a series out as a step line. The y axis ALWAYS starts at 0 (labelled as such in the UI) so a small price change is
 * not drawn as a dramatic one. Axis labels sit at fixed places (three on y, start and end on x), so they can never collide
 * however many points there are. Markers differ in SHAPE by direction (circle = start, triangle up = rise, triangle down =
 * fall), so meaning does not depend on colour.
 */
export function layoutChart(points: PricePoint[], currency: string, now: string, width = 320, height = 190): ChartLayout {
  const plot = { left: 58, right: width - 16, top: 14, bottom: height - 40 };
  const yMax = niceCeil(Math.max(...points.map(p => p.amount), 1) * 1.05);
  const y = (v: number) => plot.bottom - (v / yMax) * (plot.bottom - plot.top);
  const t0 = points[0].date;
  const end = points[points.length - 1].date > now ? points[points.length - 1].date : now;
  const span = Math.max(1, dayDiff(t0, end));
  const x = (d: string) => plot.left + (dayDiff(t0, d) / span) * (plot.right - plot.left);

  let path = `M${x(points[0].date).toFixed(1)},${y(points[0].amount).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) path += ` H${x(points[i].date).toFixed(1)} V${y(points[i].amount).toFixed(1)}`;
  path += ` H${plot.right.toFixed(1)}`; // the current price carries on to today

  const R = 5;
  const markers = points.map(p => {
    const cx = x(p.date), cy = y(p.amount);
    const shape = p.kind === 'up' ? `${cx},${cy - R - 1} ${cx - R - 1},${cy + R} ${cx + R + 1},${cy + R}`
      : p.kind === 'down' ? `${cx},${cy + R + 1} ${cx - R - 1},${cy - R} ${cx + R + 1},${cy - R}` : '';
    return { x: cx, y: cy, kind: p.kind, shape };
  });

  const money = (v: number) => formatMoney(v, currency).replace(/\.00(?=\D*$)/, '');
  const mkLabel = (text: string, lx: number, ly: number, anchor: LabelBox['anchor']): LabelBox => ({ x: lx, y: ly - GLYPH_H + 3, w: text.length * GLYPH_W, h: GLYPH_H, text, anchor });
  const yTicks = [0, yMax / 2, yMax].map(v => ({ y: y(v), label: mkLabel(money(v), plot.left - 8, y(v) + 4, 'end') }));
  const xLabels = [
    mkLabel(monthYear(t0), plot.left, height - 14, 'start'),
    mkLabel(end === now ? 'Today' : monthYear(end), plot.right, height - 14, 'end'),
  ];
  return { width, height, plot, path, markers, yTicks, xLabels, yMax };
}
