import type { MethodTotal } from './paymentMethods';

interface Props {
  rows: MethodTotal[];
  money: (n: number) => string;
  onSetRates: () => void;
}

/** What each payment method pays per month, as a bar chart made of plain CSS. The numbers are always printed too. */
export default function PaymentBreakdown({ rows, money, onSetRates }: Props) {
  const top = Math.max(...rows.map(r => r.monthly), 0);
  const needed = rows.reduce((t, r) => t + r.rateNeeded, 0);
  return (
    <section className="card" aria-labelledby="by-method-title">
      <h2 id="by-method-title">By payment method · monthly</h2>
      {rows.map(r => (
        <div className="bar-row" key={r.label ?? '__none'}>
          <span>{r.label ?? 'No label'} <small className="muted">({r.count})</small></span>
          <div className="bar" aria-hidden="true"><div className={`w-${top ? Math.round((r.monthly / top) * 20) * 5 : 0}`} /></div>
          <span className="amt">{money(r.monthly)}{r.rateNeeded > 0 && <small className="muted"> + {r.rateNeeded} rate needed</small>}</span>
        </div>
      ))}
      {needed > 0 && <p className="muted"><small>{needed} subscription{needed === 1 ? '' : 's'} left out of the amounts until you set an exchange rate. <button className="link" onClick={onSetRates}>Set rates</button></small></p>}
    </section>
  );
}
