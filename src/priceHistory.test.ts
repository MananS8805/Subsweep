import { describe, it, expect } from 'vitest';
import { buildSeries, summarize, layoutChart, boxesOverlap, niceCeil } from './priceHistory';

const NOW = '2026-10-19';
const h = (date: string, amount: number) => ({ date, amount });

describe('buildSeries', () => {
  it('sorts by date, whatever order it arrives in', () => {
    const s = buildSeries([h('2026-08-03', 17.99), h('2026-03-03', 9.99), h('2026-05-03', 12.99)], NOW);
    expect(s.map(p => p.date)).toEqual(['2026-03-03', '2026-05-03', '2026-08-03']);
  });
  it('drops repeats of the same price so every point is a real change', () => {
    const s = buildSeries([h('2026-01-01', 10), h('2026-02-01', 10), h('2026-03-01', 12), h('2026-04-01', 12), h('2026-05-01', 12)], NOW);
    expect(s.map(p => p.amount)).toEqual([10, 12]);
  });
  it('a price that goes back to an earlier value is a real change and is kept', () => {
    expect(buildSeries([h('2026-01-01', 10), h('2026-02-01', 12), h('2026-03-01', 10)], NOW).map(p => p.amount)).toEqual([10, 12, 10]);
  });
  it('marks each point as start, up or down', () => {
    expect(buildSeries([h('2026-01-01', 10), h('2026-02-01', 12), h('2026-03-01', 8)], NOW).map(p => p.kind)).toEqual(['start', 'up', 'down']);
  });
  it('a single entry is a single point', () => {
    expect(buildSeries([h('2026-01-01', 10)], NOW)).toEqual([{ date: '2026-01-01', amount: 10, kind: 'start' }]);
  });
  it('handles missing and empty input', () => {
    expect(buildSeries(undefined, NOW)).toEqual([]);
    expect(buildSeries([], NOW)).toEqual([]);
  });
  it('ignores entries with a bad date or amount, and entries dated in the future', () => {
    const s = buildSeries([h('', 5), h('soon', 5), h('2026-01-01', NaN), h('2026-01-01', 0), h('2026-02-01', 10), h('2027-01-01', 99)], NOW);
    expect(s).toEqual([{ date: '2026-02-01', amount: 10, kind: 'start' }]);
  });
  it('is stable for two entries on the same day', () => {
    expect(buildSeries([h('2026-01-01', 10), h('2026-01-01', 12)], NOW).map(p => p.amount)).toEqual([10, 12]);
  });
});

describe('summarize', () => {
  it('increase: "Rose from ... to ... (+30%) since Mar 2026"', () => {
    const s = summarize([h('2026-03-03', 9.99), h('2026-08-03', 12.99)], 'USD', NOW, 'en-US');
    expect(s).toMatchObject({ kind: 'up', percent: 30, from: 9.99, to: 12.99, changes: 1 });
    expect(s.text).toBe('Rose from $9.99 to $12.99 (+30%) since Mar 2026');
  });
  it('decrease uses a real minus sign and "Fell"', () => {
    const s = summarize([h('2026-03-03', 10), h('2026-08-03', 8)], 'USD', NOW, 'en-US');
    expect(s).toMatchObject({ kind: 'down', percent: -20 });
    expect(s.text).toBe('Fell from $10.00 to $8.00 (−20%) since Mar 2026');
  });
  it('rounds the percentage to a whole number', () => {
    expect(summarize([h('2026-01-01', 15.49), h('2026-02-01', 17.99)], 'USD', NOW, 'en-US').percent).toBe(16);   // 16.14
    expect(summarize([h('2026-01-01', 3), h('2026-02-01', 4)], 'USD', NOW, 'en-US').percent).toBe(33);          // 33.33
    expect(summarize([h('2026-01-01', 3), h('2026-02-01', 5)], 'USD', NOW, 'en-US').percent).toBe(67);          // 66.67
    expect(summarize([h('2026-01-01', 1000), h('2026-02-01', 1004)], 'USD', NOW, 'en-US').percent).toBe(0);     // 0.4
  });
  it('uses the first and last price across several changes', () => {
    const s = summarize([h('2026-03-03', 9.99), h('2026-05-03', 12.99), h('2026-08-03', 14.99)], 'USD', NOW, 'en-US');
    expect(s).toMatchObject({ kind: 'up', changes: 2, from: 9.99, to: 14.99, percent: 50 });
  });
  it('up and back down to the start is reported as flat, with the number of changes', () => {
    const s = summarize([h('2026-01-01', 10), h('2026-02-01', 12), h('2026-03-01', 10)], 'USD', NOW, 'en-US');
    expect(s).toMatchObject({ kind: 'flat', changes: 2, percent: 0 });
    expect(s.text).toMatch(/Changed 2 times and is back to \$10\.00/);
  });
  it('one entry, or none, says there are no price changes', () => {
    expect(summarize([h('2026-01-01', 10)], 'USD', NOW).text).toBe('No price changes recorded');
    expect(summarize([], 'USD', NOW).kind).toBe('none');
    expect(summarize(undefined, 'USD', NOW).kind).toBe('none');
  });
  it('formats in the subscription\'s own currency', () => {
    expect(summarize([h('2026-01-01', 499), h('2026-02-01', 649)], 'INR', NOW, 'en-US').text).toMatch(/₹499\.00 to ₹649\.00 \(\+30%\)/);
    expect(summarize([h('2026-01-01', 10), h('2026-02-01', 12)], 'EUR', NOW, 'en-US').text).toMatch(/€10\.00 to €12\.00/);
  });
});

describe('chart layout', () => {
  const series = (n: number) => buildSeries(Array.from({ length: n }, (_, i) => h(`2026-${String(1 + Math.floor(i / 2)).padStart(2, '0')}-${i % 2 ? '20' : '03'}`, 10 + i * (i % 3 === 0 ? -0.5 : 1.7))), NOW);

  for (const n of [2, 5, 20]) {
    it(`${n} points: every marker is inside the plot and no two labels overlap`, () => {
      const pts = series(n);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      const L = layoutChart(pts, 'USD', NOW);
      for (const m of L.markers) {
        expect(m.x).toBeGreaterThanOrEqual(L.plot.left - 0.01); expect(m.x).toBeLessThanOrEqual(L.plot.right + 0.01);
        expect(m.y).toBeGreaterThanOrEqual(L.plot.top - 0.01); expect(m.y).toBeLessThanOrEqual(L.plot.bottom + 0.01);
      }
      const labels = [...L.yTicks.map(t => t.label), ...L.xLabels];
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(boxesOverlap(labels[i], labels[j]), `${labels[i].text} vs ${labels[j].text}`).toBe(false);
      for (const b of labels) expect(b.x - (b.anchor === 'end' ? b.w : 0)).toBeGreaterThanOrEqual(0);   // nothing is clipped on the left
    });
  }
  it('the y axis always starts at 0, so a small change looks small', () => {
    const L = layoutChart(buildSeries([h('2026-01-01', 100), h('2026-02-01', 103)], NOW), 'USD', NOW);
    expect(L.yTicks[0].label.text).toBe('$0');
    expect(L.yTicks[0].y).toBe(L.plot.bottom);
    const [a, b] = L.markers;
    expect(a.y - b.y).toBeLessThan(0.1 * (L.plot.bottom - L.plot.top)); // a 3% rise is a small step, not a cliff
  });
  it('shape encodes direction, not just colour', () => {
    const L = layoutChart(buildSeries([h('2026-01-01', 10), h('2026-02-01', 12), h('2026-03-01', 8)], NOW), 'USD', NOW);
    expect(L.markers.map(m => m.kind)).toEqual(['start', 'up', 'down']);
    expect(L.markers[0].shape).toBe('');                          // circle
    expect(L.markers[1].shape).not.toBe(L.markers[2].shape);      // two different triangles
    expect(L.markers[1].shape).toBeTruthy(); expect(L.markers[2].shape).toBeTruthy();
  });
  it('draws a step line that carries on to today', () => {
    const L = layoutChart(buildSeries([h('2026-01-01', 10), h('2026-06-01', 12)], NOW), 'USD', NOW);
    expect(L.path.startsWith('M')).toBe(true);
    expect(L.path).toContain(' V');
    expect(L.path.endsWith(`H${L.plot.right.toFixed(1)}`)).toBe(true);
    expect(L.xLabels[1].text).toBe('Today');
  });
  it('niceCeil gives round axis maxima', () => {
    expect([niceCeil(0.7), niceCeil(1.3), niceCeil(3.1), niceCeil(7), niceCeil(13.6), niceCeil(649 * 1.05)]).toEqual([1, 2, 5, 10, 20, 1000]);
  });
});
