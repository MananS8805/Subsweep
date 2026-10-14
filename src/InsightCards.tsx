import type { Insight } from './insights';

interface Props {
  insights: Insight[];
  money: (n: number) => string;
  onDismiss: (id: string) => void;
  onReview: (i: Insight) => void;
  onUsed: (i: Insight) => void;
}

const ICON: Record<Insight['type'], string> = { overlap: '⧉', unused: '⏳', creep: '↗', trial: '⏰' };

/** Cards for things worth a second look: overlapping services, unused ones, price hikes, trials about to convert. */
export default function InsightCards({ insights, money, onDismiss, onReview, onUsed }: Props) {
  if (!insights.length) return null;
  const total = insights.reduce((t, i) => t + i.potentialYearlySaving, 0);
  return (
    <section aria-label="Insights">
      <h2>Insights · up to {money(total)}/yr to look at</h2>
      <div className="insights">
        {insights.map(i => (
          <article key={i.id} className={`insight it-${i.type}`}>
            <div className="it-head"><span className="it-icon" aria-hidden="true">{ICON[i.type]}</span><h3>{i.title}</h3></div>
            <p className="muted">{i.detail}</p>
            {i.potentialYearlySaving > 0 && <p className="save-line">Could save <b>{money(i.potentialYearlySaving)}</b> a year</p>}
            <div className="row-actions">
              <button className="link" onClick={() => onDismiss(i.id)}>Dismiss</button>
              {i.type === 'unused' && <button className="link" onClick={() => onUsed(i)}>Used recently</button>}
              <button className="btn" onClick={() => onReview(i)}>Review &amp; select</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
