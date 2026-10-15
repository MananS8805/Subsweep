import { useState } from 'react';
import { CURRENCIES, isValidRate, type Rates } from './currency';
import { subCurrency } from './savings';
import type { Subscription } from './types';

interface Props {
  base: string;
  rates: Rates;
  subs: Subscription[];
  needReview: boolean;
  onBase: (code: string) => void;
  onRate: (code: string, rate: number | null) => void;
  onReviewed: () => void;
}

/** Base currency picker and a manual rates table (only currencies in use). Rates never leave the device. */
export default function CurrencySettings({ base, rates, subs, needReview, onBase, onRate, onReviewed }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [bad, setBad] = useState('');
  const inUse = [...new Set(subs.map(s => subCurrency(s, base)))].filter(c => c !== base).sort();

  function commit(code: string) {
    const raw = (draft[code] ?? '').trim();
    setDraft(d => { const { [code]: _gone, ...rest } = d; return rest; });
    if (raw === '') { if (rates[code] !== undefined) onRate(code, null); setBad(''); return; }
    const n = Number(raw);
    if (!isValidRate(n)) { setBad(`The rate for ${code} must be a number greater than 0.`); return; }
    setBad(''); onRate(code, n);
  }

  return (
    <section className="card" id="currency-settings" aria-label="Currency settings">
      <h2>Currency</h2>
      <p className="muted">Totals are shown in your base currency. Exchange rates are typed in by you and never fetched.</p>
      {needReview && (
        <p className="notice review" role="status">
          You changed the base currency. Existing rates were kept but now mean "{base} per 1 unit", so please review them below.{' '}
          <button className="link" onClick={onReviewed}>Mark as reviewed</button>
        </p>
      )}
      <label className="form-row">Base currency
        <select value={base} onChange={e => onBase(e.target.value)}>
          {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
        </select>
      </label>
      {inUse.length === 0
        ? <p className="muted">All your subscriptions are in {base}, so no rates are needed.</p>
        : (
          <div className="rates-wrap"><table className="rates">
            <thead><tr><th scope="col">Currency</th><th scope="col">Rate</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {inUse.map(code => {
                const missing = !isValidRate(rates[code]);
                return (
                  <tr key={code}>
                    <th scope="row">1 {code} =</th>
                    <td>
                      <input
                        inputMode="decimal" aria-label={`${base} per 1 ${code}`} placeholder="0.00"
                        value={draft[code] ?? (rates[code] !== undefined ? String(rates[code]) : '')}
                        onChange={e => setDraft(d => ({ ...d, [code]: e.target.value }))}
                        onBlur={() => commit(code)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(code); } }}
                      /> {base}
                    </td>
                    <td>{missing ? <span className="pill st-zombie">set rate</span> : <span className="muted">ok</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      {bad && <p className="error" role="alert">{bad}</p>}
    </section>
  );
}
