import { buildSeries, layoutChart, summarize } from './priceHistory';
import { formatMoney } from './currency';

interface Props {
  history: { date: string; amount: number }[] | undefined;
  currency: string;
  name: string;
  now: string;   // local date, YYYY-MM-DD
}

const dateLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * A step line of how a subscription's price changed. It is an image to assistive tech (role="img" with the one-sentence
 * summary as its label) and a real table sits next to it, hidden visually but read by screen readers. Direction is shown
 * by marker SHAPE (circle, triangle up, triangle down) as well as colour, and the vertical axis always starts at 0.
 */
export default function PriceChart({ history, currency, name, now }: Props) {
  const points = buildSeries(history, now);
  if (points.length < 2) return <p className="muted">No price changes recorded.</p>;
  const summary = summarize(history, currency, now);
  const L = layoutChart(points, currency, now);
  return (
    <figure className="pc-fig">
      <figcaption className="pc-summary"><b>{summary.text}</b></figcaption>
      <svg className="pc" viewBox={`0 0 ${L.width} ${L.height}`} role="img" aria-label={`${name} price history. ${summary.text}.`}>
        {L.yTicks.map((t, i) => <line key={i} className={i === 0 ? 'pc-axis' : 'pc-grid'} x1={L.plot.left} x2={L.plot.right} y1={t.y} y2={t.y} />)}
        <path className="pc-line" d={L.path} fill="none" />
        {L.markers.map((m, i) => m.kind === 'start'
          ? <circle key={i} className="pc-mark pc-start" cx={m.x} cy={m.y} r={5} />
          : <polygon key={i} className={`pc-mark pc-${m.kind}`} points={m.shape} />)}
        {[...L.yTicks.map(t => t.label), ...L.xLabels].map((b, i) => (
          <text key={i} className="pc-text" x={b.x} y={b.y + 9} textAnchor={b.anchor}>{b.text}</text>
        ))}
      </svg>
      <ul className="pc-legend" aria-hidden="true">
        <li><span className="pc-key pc-key-start">●</span> first price</li>
        <li><span className="pc-key pc-key-up">▲</span> went up</li>
        <li><span className="pc-key pc-key-down">▼</span> went down</li>
      </ul>
      <p className="muted pc-note">The vertical axis starts at 0, so a small change looks small.</p>
      <table className="sr-only">
        <caption>Price history for {name}</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Price</th><th scope="col">Change</th></tr></thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.date + p.amount}>
              <th scope="row">{dateLabel(p.date)}</th>
              <td>{formatMoney(p.amount, currency)}</td>
              <td>{i === 0 ? 'First price' : `${p.kind === 'up' ? 'Up' : 'Down'} ${Math.abs(Math.round(((p.amount - points[i - 1].amount) / points[i - 1].amount) * 100))}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
