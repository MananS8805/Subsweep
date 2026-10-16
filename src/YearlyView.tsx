import { useMemo } from 'react';
import { CYCLE_SHORT, isLive, type Subscription } from './types';
import { categoryYearly, savingsFor, totals, yearlyCost, missingCurrencies, subCurrency } from './savings';
import { convert, type Rates } from './currency';
import BrandLogo from './BrandLogo';

export type YearlySort = 'yearly' | 'name' | 'renewal';

interface Props {
  subs: Subscription[];
  base: string;
  rates: Rates;
  money: (n: number, currency?: string) => string;
  sort: YearlySort;
  onSort: (s: YearlySort) => void;
  onToggle: (s: Subscription) => void;
  onClear: () => void;
  onUsed: (s: Subscription) => void;
  onOpen: (s: Subscription) => void;
}


/** Yearly cost of everything you pay for, plus a "what would I save" simulator driven by the Cancel? ticks. */
export default function YearlyView({ subs, base, rates, money, sort, onSort, onToggle, onClear, onUsed, onOpen }: Props) {
  const live = useMemo(() => subs.filter(isLive), [subs]);
  const tot = useMemo(() => totals(live, base, rates), [live, base, rates]);
  const cats = useMemo(() => categoryYearly(live, base, rates), [live, base, rates]);
  const selectedIds = useMemo(() => live.filter(s => s.selectedForCancel).map(s => s.id!), [live]);
  const sav = useMemo(() => savingsFor(live, selectedIds, base, rates), [live, selectedIds, base, rates]);
  const missing = missingCurrencies(live, base, rates);

  const rows = useMemo(() => {
    const y = (s: Subscription) => yearlyCost(s, base, rates) ?? -1;
    return [...live].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'renewal' ? a.nextRenewal.localeCompare(b.nextRenewal) : y(b) - y(a));
  }, [live, sort, base, rates]);

  return (
    <section aria-label="Yearly cost">
      <div className="summary">
        <div className="stat"><span>Per year</span><strong>{money(tot.yearly)}</strong></div>
        <div className="stat"><span>Per month</span><strong>{money(tot.monthly)}</strong></div>
        <div className="stat"><span>In 5 years</span><strong>{money(tot.yearly * 5)}</strong></div>
      </div>
      {missing.length > 0 && <p className="error" role="alert">Left out of these totals until you set a rate for {missing.join(', ')}.</p>}

      <div className="card savings" aria-live="polite">
        <h2>What you'd save</h2>
        {sav.count === 0 ? (
          <p className="muted">Tick "Cancel?" on anything you're thinking of dropping and the savings show up here.</p>
        ) : (
          <>
            <p className="save-line">
              Cancelling <b>{sav.count}</b> item{sav.count === 1 ? '' : 's'} saves <b>{money(sav.monthly)}</b> a month,
              {' '}<b>{money(sav.yearly)}</b> a year, and about <b>{money(sav.fiveYear)}</b> over 5 years.
            </p>
            {sav.missing.length > 0 && <p className="error">Not counted (no exchange rate): {sav.missing.map(s => s.name).join(', ')}.</p>}
            <div className="row-actions"><button className="btn" onClick={onClear}>Clear selection</button></div>
          </>
        )}
      </div>

      {cats.length > 0 && (
        <div className="card">
          <h2>By category · yearly</h2>
          {cats.map(([c, v]) => (
            <div className="bar-row" key={c}>
              <span>{c}</span>
              <div className="bar"><div style={{ width: `${(v / cats[0][1]) * 100}%` }} /></div>
              <span className="amt">{money(v)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="row sort-row">
        <h2>Every subscription</h2>
        <label className="sort">Sort
          <select value={sort} onChange={e => onSort(e.target.value as YearlySort)}>
            <option value="yearly">Yearly cost, high to low</option>
            <option value="name">Name</option>
            <option value="renewal">Next renewal</option>
          </select>
        </label>
      </div>
      {rows.length === 0 && <p className="empty">Nothing to show yet.</p>}
      {rows.map(s => {
        const cur = subCurrency(s, base);
        const y = yearlyCost(s, base, rates);
        const conv = cur === base ? null : convert(s.amount, cur, base, rates);
        return (
          <article className={`card sub yearly-row${s.selectedForCancel ? ' picked' : ''}`} key={s.id}>
            <div className="row">
              <label className="with-logo cancel-pick">
                <input type="checkbox" checked={!!s.selectedForCancel} onChange={() => onToggle(s)} aria-label={`Cancel ${s.name}?`} />
                <BrandLogo name={s.name} size={40} />
                <span>
                  <button className="link name" onClick={() => onOpen(s)}>{s.name}</button>
                  <small className="muted block">{money(s.amount, cur)}/{CYCLE_SHORT[s.cycle]}{conv !== null && ` ≈ ${money(conv)}`}{s.isTrial && ' · trial'}</small>
                </span>
              </label>
              <div className="price">
                {y === null ? <span className="pill st-zombie" title={`Set a rate for ${cur} in Currency settings`}>set rate</span> : <>{money(y)}<small>/yr</small></>}
                <small className="block">Cancel?</small>
              </div>
            </div>
            <div className="row-actions">
              {s.lastUsedAt && <small className="muted">Last used {s.lastUsedAt}</small>}
              <button className="link" onClick={() => onUsed(s)}>Used recently</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
