import type { Digest as DigestData } from './digest';
import type { Subscription } from './types';
import BrandLogo from './BrandLogo';
import EmptyState from './EmptyState';

interface Props {
  digest: DigestData;
  subs: Subscription[];
  money: (n: number, currency?: string) => string;
  onOpen: (s: Subscription) => void;
  onCopy: () => void;
  onPrint: () => void;
  onCsv: () => void;
  onSetRates: () => void;
}

const day = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Everything that will be charged in the next 30 days, by week, with the total in your base currency. */
export default function DigestView({ digest: d, subs, money, onOpen, onCopy, onPrint, onCsv, onSetRates }: Props) {
  const byId = new Map(subs.map(s => [s.id, s]));
  const name = (id: number) => byId.get(id)?.name ?? 'Subscription';
  const nothing = d.payments.length === 0 && d.trialsEnding.length === 0;

  return (
    <section aria-labelledby="digest-title" className="digest">
      <div className="row sort-row no-print-row">
        <h2 id="digest-title">Next {d.days} days · {shortDay(d.from)} to {shortDay(d.to)}</h2>
        <div className="actions">
          <button className="btn" onClick={onCopy}>Copy summary</button>
          <button className="btn" onClick={onCsv}>Export CSV</button>
          <button className="btn" onClick={onPrint}>Print</button>
        </div>
      </div>

      {nothing ? (
        <EmptyState title={`Nothing is due in the next ${d.days} days`}>Renewals and trial endings will appear here as they come within {d.days} days.</EmptyState>
      ) : (
        <>
          <div className="summary">
            <div className="stat"><span>Due in {d.days} days</span><strong>{money(d.total)}</strong></div>
            <div className="stat"><span>Payments</span><strong>{d.payments.length}</strong></div>
            <div className="stat"><span>Busiest week</span><strong>{d.busiestWeek ? `${shortDay(d.busiestWeek.start)} · ${money(d.busiestWeek.total)}` : 'None'}</strong></div>
          </div>

          {d.rateNeeded.length > 0 && (
            <div className="card warn" role="note">
              <h3>Exchange rate needed</h3>
              <p className="muted">Not counted in the total: {d.rateNeeded.map(r => `${name(r.subId)} (${r.currency})`).join(', ')}.</p>
              <div className="row-actions"><button className="btn primary" onClick={onSetRates}>Set rates</button></div>
            </div>
          )}

          {d.trialsEnding.length > 0 && (
            <div className="card trial-card">
              <h3>Free trials ending</h3>
              <p className="muted">These are not in the total. Cancel before the date if you do not want to be charged.</p>
              <ul className="plain">
                {d.trialsEnding.map(t => {
                  const s = byId.get(t.subId)!;
                  return (
                    <li key={t.subId} className="with-logo">
                      <BrandLogo name={s.name} size={34} />
                      <span><button className="link name" onClick={() => onOpen(s)}>{s.name}</button> <span className="pill trial">trial</span>
                        <small className="muted block">{day(t.date)} · {t.daysLeft === 0 ? 'today' : t.daysLeft === 1 ? 'tomorrow' : `in ${t.daysLeft} days`} · {money(s.amount, s.currency)} after</small></span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {d.weeks.map(w => (
            <section key={w.start} className={`card week${d.busiestWeek?.start === w.start ? ' busiest' : ''}`} aria-labelledby={`wk-${w.start}`}>
              <div className="row">
                <h3 id={`wk-${w.start}`}>Week of {shortDay(w.start)}</h3>
                <strong>{w.items.length ? money(w.total) : '–'}{d.busiestWeek?.start === w.start && <span className="pill busy"> busiest</span>}</strong>
              </div>
              {w.items.length === 0 ? <p className="muted">Nothing due.</p> : (
                <ul className="plain">
                  {w.items.map((p, i) => {
                    const s = byId.get(p.subId)!;
                    return (
                      <li key={`${p.subId}-${p.date}-${i}`} className="digest-row">
                        <span className="digest-date">{day(p.date)}</span>
                        <span className="with-logo"><BrandLogo name={s.name} size={30} />
                          <span><button className="link name" onClick={() => onOpen(s)}>{s.name}</button>
                            {(p.muted || p.snoozed) && <small className="muted block">{p.muted ? 'Reminders muted' : 'Reminders snoozed'}</small>}</span></span>
                        <b className="digest-amt">{money(p.amountBase)}</b>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
          {d.mutedCount > 0 && <p className="muted">{d.mutedCount} of these {d.mutedCount === 1 ? 'has' : 'have'} reminders muted or snoozed, but still cost{d.mutedCount === 1 ? 's' : ''} money, so {d.mutedCount === 1 ? 'it is' : 'they are'} included.</p>}
        </>
      )}
    </section>
  );
}
