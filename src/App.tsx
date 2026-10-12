import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from './db';
import { CATEGORIES, type Cycle, type Detected, type Subscription } from './types';
import { detectRecurring, monthlyCost, nextOnOrAfter, parseStatement } from './detect';
import { buildIcs } from './ics';
import { cancelHint } from './cancelGuides';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
const daysUntil = (d: string) => Math.round((+new Date(d + 'T00:00:00Z') - +new Date(today() + 'T00:00:00Z')) / 86400000);
const blank = (): Subscription => ({ name: '', amount: 0, cycle: 'monthly', nextRenewal: today(), category: 'Other', isTrial: false });

function guessCategory(name: string): string {
  const n = name.toLowerCase();
  const map: [RegExp, string][] = [
    [/netflix|hulu|disney|hbo|max|prime video|paramount|peacock|youtube/, 'Streaming'],
    [/spotify|apple music|tidal|pandora|audible/, 'Music'],
    [/adobe|microsoft|github|notion|figma|canva|chatgpt|openai/, 'Software'],
    [/dropbox|icloud|google one|onedrive/, 'Cloud & Storage'],
    [/times|post|journal|medium|substack|kindle/, 'News & Reading'],
    [/gym|fitness|peloton|headspace|calm|strava/, 'Fitness & Health'],
    [/xbox|playstation|steam|nintendo|twitch/, 'Gaming'],
    [/prime|costco|walmart/, 'Shopping'],
  ];
  return map.find(([re]) => re.test(n))?.[1] ?? 'Other';
}

export default function App() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [found, setFound] = useState<(Detected & { keep: boolean })[] | null>(null);
  const [error, setError] = useState('');
  const [notifState, setNotifState] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => setSubs(await db.subs.orderBy('nextRenewal').toArray());
  useEffect(() => { load(); }, []);

  // Roll past renewal dates forward, and fire in-page reminders for anything due within 3 days.
  useEffect(() => {
    if (!subs.length) return;
    (async () => {
      for (const s of subs) {
        const rolled = s.isTrial ? s.nextRenewal : nextOnOrAfter(s.nextRenewal, s.cycle);
        if (rolled !== s.nextRenewal) await db.subs.update(s.id!, { nextRenewal: rolled });
      }
    })();
    if (notifState === 'granted') {
      const key = 'subsweep-notified-' + today();
      if (!localStorage.getItem(key)) {
        const due = subs.filter(s => daysUntil(s.nextRenewal) >= 0 && daysUntil(s.nextRenewal) <= 3);
        due.forEach(s => new Notification(`${s.isTrial ? 'Trial ends' : 'Renews'} soon: ${s.name}`, { body: `${money(s.amount)} on ${s.nextRenewal}` }));
        localStorage.setItem(key, '1');
      }
    }
  }, [subs.length, notifState]);

  const monthly = useMemo(() => subs.filter(s => !s.isTrial).reduce((t, s) => t + monthlyCost(s.amount, s.cycle), 0), [subs]);
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    subs.filter(s => !s.isTrial).forEach(s => m.set(s.category, (m.get(s.category) ?? 0) + monthlyCost(s.amount, s.cycle)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [subs]);
  const upcoming = subs.filter(s => daysUntil(s.nextRenewal) <= 7 && daysUntil(s.nextRenewal) >= 0);

  async function onFile(f: File | undefined) {
    setError('');
    if (!f) return;
    try {
      const txns = parseStatement(await f.text());
      const existing = new Set(subs.map(s => s.name.toLowerCase()));
      const det = detectRecurring(txns).filter(d => !existing.has(d.name.toLowerCase()));
      if (!det.length) setError('No new recurring charges found. Statements covering 3+ months work best.');
      setFound(det.length ? det.map(d => ({ ...d, keep: true })) : null);
    } catch (e) { setError((e as Error).message); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function importFound() {
    const rows = (found ?? []).filter(d => d.keep).map<Subscription>(d => ({
      name: d.name, amount: d.amount, cycle: d.cycle, nextRenewal: d.nextRenewal,
      category: guessCategory(d.name), isTrial: false, priceCreep: d.priceCreep,
    }));
    await db.subs.bulkAdd(rows);
    setFound(null); load();
  }

  async function save(s: Subscription) {
    if (!s.name.trim() || !(s.amount > 0)) return;
    s.id ? await db.subs.put(s) : await db.subs.add(s);
    setEditing(null); load();
  }
  async function remove(id: number) { if (confirm('Remove this subscription?')) { await db.subs.delete(id); load(); } }

  function download(name: string, content: string, type: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  async function askNotif() { if (typeof Notification !== 'undefined') setNotifState(await Notification.requestPermission()); }

  return (
    <div className="app">
      <header>
        <h1>SubSweep</h1>
        <p className="tag">Find the subscriptions quietly draining your money. Your data never leaves this device.</p>
      </header>

      <section className="summary">
        <div className="stat"><span>Per month</span><strong>{money(monthly)}</strong></div>
        <div className="stat"><span>Per year</span><strong>{money(monthly * 12)}</strong></div>
        <div className="stat"><span>Active</span><strong>{subs.filter(s => !s.isTrial).length}</strong></div>
      </section>

      <section className="actions">
        <label className="btn primary">Scan bank statement (CSV)
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0])} />
        </label>
        <button className="btn" onClick={() => setEditing(blank())}>+ Add manually</button>
        <button className="btn" disabled={!subs.length} onClick={() => download('subsweep-renewals.ics', buildIcs(subs), 'text/calendar')}>Export calendar (.ics)</button>
        {notifState === 'default' && <button className="btn" onClick={askNotif}>Enable reminders</button>}
      </section>
      {error && <p className="error" role="alert">{error}</p>}

      {upcoming.length > 0 && (
        <section className="card warn">
          <h2>Renewing in the next 7 days</h2>
          <ul className="plain">{upcoming.map(s => <li key={s.id}><b>{s.name}</b> · {money(s.amount)} · {daysUntil(s.nextRenewal) === 0 ? 'today' : `in ${daysUntil(s.nextRenewal)}d`}{s.isTrial && ' (trial ends)'}</li>)}</ul>
        </section>
      )}

      {byCat.length > 0 && (
        <section className="card">
          <h2>By category (monthly)</h2>
          {byCat.map(([c, v]) => (
            <div className="bar-row" key={c}>
              <span>{c}</span>
              <div className="bar"><div style={{ width: `${(v / byCat[0][1]) * 100}%` }} /></div>
              <span className="amt">{money(v)}</span>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2>Your subscriptions</h2>
        {subs.length === 0 && <p className="empty">Nothing yet. Upload a statement CSV from your bank, or add a subscription by hand.</p>}
        {subs.map(s => (
          <article className="card sub" key={s.id}>
            <div className="row">
              <div>
                <h3>{s.name} {s.isTrial && <span className="pill trial">trial</span>}</h3>
                <p className="muted">{s.category} · {s.cycle} · next {s.nextRenewal} ({daysUntil(s.nextRenewal)}d)</p>
                {s.priceCreep && <p className="creep">Price crept up: {money(s.priceCreep.from)} → {money(s.priceCreep.to)}</p>}
              </div>
              <div className="price">{money(s.amount)}<small>/{s.cycle.replace('ly', '').replace('week', 'wk').replace('month', 'mo').replace('quarter', 'qtr').replace('year', 'yr')}</small></div>
            </div>
            <details><summary>How to cancel</summary><p className="muted">{cancelHint(s.name)}</p></details>
            <div className="row-actions">
              <button className="link" onClick={() => setEditing(s)}>Edit</button>
              <button className="link danger" onClick={() => remove(s.id!)}>Remove</button>
            </div>
          </article>
        ))}
      </section>

      {found && (
        <Modal onClose={() => setFound(null)} title={`Found ${found.length} recurring charge${found.length > 1 ? 's' : ''}`}>
          <p className="muted">Untick anything that isn't a subscription.</p>
          <ul className="plain">
            {found.map((d, i) => (
              <li key={d.name}>
                <label><input type="checkbox" checked={d.keep} onChange={e => setFound(found.map((x, j) => j === i ? { ...x, keep: e.target.checked } : x))} />
                  {' '}<b>{d.name}</b> · {money(d.amount)} {d.cycle} · seen {d.occurrences}×{d.priceCreep && <span className="creep"> · price up {money(d.priceCreep.from)}→{money(d.priceCreep.to)}</span>}</label>
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={importFound}>Add selected</button>
        </Modal>
      )}

      {editing && <EditForm sub={editing} onSave={save} onCancel={() => setEditing(null)} />}
      <footer>Local-only · no accounts · no tracking. Always confirm cancellation steps on the provider's site.</footer>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="row"><h2>{title}</h2><button className="link" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

function EditForm({ sub, onSave, onCancel }: { sub: Subscription; onSave: (s: Subscription) => void; onCancel: () => void }) {
  const [s, setS] = useState(sub);
  const set = <K extends keyof Subscription>(k: K, v: Subscription[K]) => setS(p => ({ ...p, [k]: v }));
  return (
    <Modal title={sub.id ? 'Edit subscription' : 'Add subscription'} onClose={onCancel}>
      <form onSubmit={e => { e.preventDefault(); onSave({ ...s, category: s.category || guessCategory(s.name) }); }} className="form">
        <label>Name<input required value={s.name} onChange={e => set('name', e.target.value)} /></label>
        <label>Amount (USD)<input required type="number" min="0.01" step="0.01" value={s.amount || ''} onChange={e => set('amount', +e.target.value)} /></label>
        <label>Billing cycle
          <select value={s.cycle} onChange={e => set('cycle', e.target.value as Cycle)}>
            <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
          </select></label>
        <label>Next renewal / trial end<input required type="date" value={s.nextRenewal} onChange={e => set('nextRenewal', e.target.value)} /></label>
        <label>Category
          <select value={s.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={s.isTrial} onChange={e => set('isTrial', e.target.checked)} /> This is a free trial (remind me before it converts)</label>
        <div className="row-actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}
