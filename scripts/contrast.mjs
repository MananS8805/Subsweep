const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = h => { const [r, g, b] = [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const themes = {
  light: { bg: '#f2f1ec', fg: '#0b0b0c', muted: '#6b6f78', card: '#ffffff', card2: '#f7f6f2', line: '#dcdad2', accent: '#0b0b0c', accentInk: '#ffffff', warn: '#b45309', danger: '#b91c1c', ok: '#1a7f37' },
  dark: { bg: '#060708', fg: '#f4f4ef', muted: '#8a8f99', card: '#0f1115', card2: '#15181e', line: '#1e222a', accent: '#c8ff3d', accentInk: '#0a0c06', warn: '#fbbf24', danger: '#f87171', ok: '#c8ff3d' },
};
const pairs = (t) => [
  ['fg on bg', t.fg, t.bg], ['fg on card', t.fg, t.card], ['fg on card2', t.fg, t.card2],
  ['muted on bg', t.muted, t.bg], ['muted on card', t.muted, t.card], ['muted on card2', t.muted, t.card2],
  ['warn text on bg', t.warn, t.bg], ['warn text on card', t.warn, t.card], ['danger text on bg', t.danger, t.bg], ['danger on card', t.danger, t.card],
  ['ok text on bg', t.ok, t.bg], ['accent-ink on accent (btn primary)', t.accentInk, t.accent],
  ['accent focus ring on bg (3:1)', t.accent, t.bg], ['accent focus ring on card (3:1)', t.accent, t.card],
  ['line on bg (border, 3:1 ideal)', t.line, t.bg],
  ['#111 on warn (pill)', '#111111', t.warn], ['white on warn (pill)', '#ffffff', t.warn],
  ['#ffffff on muted (pill)', '#ffffff', t.muted], [`bg on muted (pill)`, t.bg, t.muted],
  ['#1a0505 on danger (pill)', '#1a0505', t.danger], ['white on danger (pill)', '#ffffff', t.danger],
  ['#04210f on #22c55e (pill)', '#04210f', '#22c55e'], ['white on #22c55e', '#ffffff', '#22c55e'],
];
for (const [name, t] of Object.entries(themes)) {
  console.log('==', name);
  for (const [label, a, b] of pairs(t)) {
    const r = ratio(a, b);
    console.log(`${r.toFixed(2).padStart(6)}  ${r >= 4.5 ? 'AA ' : r >= 3 ? 'ui ' : 'FAIL'}  ${label}`);
  }
}
