import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from './db';
import { CATEGORIES, type Cycle, type Detected, type Subscription } from './types';
import { detectRecurring, monthlyCost, nextOnOrAfter, parseStatementDetailed } from './detect';
import { findDuplicates, groupPairKeys, isAlreadyTracked, mergeSubscriptions } from './dedupe';
import { backupFileName, exportBackup, importBackup, parseBackup, type ImportMode } from './backup';
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
  const [notice, setNotice] = useState('');
  const [scanInfo, setScanInfo] = useState({ skipped: 0, tracked: 0 });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [pendingBackup, setPendingBackup] = useState<{ text: string; count: number } | null>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [notifState, setNotifState] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setSubs(await db.subs.orderBy('nextRenewal').toArray());
    setDismissed((await db.dismissedDuplicates.toArray()).map(d => d.key));
  };
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
  const duplicateGroups = useMemo(() => findDuplicates(subs, dismissed), [subs, dismissed]);
  const upcoming = subs.filter(s => daysUntil(s.nextRenewal) <= 7 && daysUntil(s.nextRenewal) >= 0);

  async function onFile(f: File | undefined) {
    setError(''); setNotice('');
    if (!f) return;
    try {
      const { txns, skippedRows } = parseStatementDetailed(await f.text());
      const all = detectRecurring(txns);
      const det = all.filter(d => !isAlreadyTracked(d.name, subs));
      const tracked = all.length - det.length;
      const info = [skippedRows ? `${skippedRows} row${skippedRows > 1 ? 's' : ''} skipped` : '', tracked ? `${tracked} already tracked` : ''].filter(Boolean).join(' · ');
      setScanInfo({ skipped: skippedRows, tracked });
      if (!det.length) {
        if (tracked) setNotice(`Nothing new to add. ${info}.`);
        else setError(`No recurring charges found. Statements covering 3+ months work best.${skippedRows ? ` ${info}.` : ''}`);
      }
      setFound(det.length ? det.map(d => ({ ...d, keep: true })) : null);
    } catch (e) { setError((e as Error).message); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function importFound() {
    const rows = (found ?? []).filter(d => d.keep).map<Subscription>(d => ({
      name: d.name, amount: d.amount, cycle: d.cycle, nextRenewal: d.nextRenewal,
      category: guessCategory(d.name), isTrial: false, priceCreep: d.priceCreep, createdAt: new Date().toISOString(),
    }));
    await db.subs.bulkAdd(rows);
    setFound(null); load();
  }

  async function save(s: Subscription) {
    if (!s.name.trim() || !(s.amount > 0)) return;
    s.id ? await db.subs.put(s) : await db.subs.add({ ...s, createdAt: new Date().toISOString() });
    setEditing(null); load();
  }
  async function remove(id: number) { if (confirm('Remove this subscription?')) { await db.subs.delete(id); load(); } }

  async function mergeGroup(group: Subscription[]) {
    const { keep, removeIds } = mergeSubscriptions(group);
    await db.transaction('rw', db.subs, db.dismissedDuplicates, async () => {
      await db.subs.put(keep);
      await db.subs.bulkDelete(removeIds);
      const stale = (await db.dismissedDuplicates.toArray()).filter(d => d.key.split('-').some(id => removeIds.includes(+id)));
      await db.dismissedDuplicates.bulkDelete(stale.map(d => d.id!));
    });
    load();
  }
  async function dismissGroup(group: Subscription[]) {
    const fresh = groupPairKeys(group).filter(k => !dismissed.includes(k));
    await db.dismissedDuplicates.bulkAdd(fresh.map(key => ({ key })));
    load();
  }

  async function downloadBackup() {
    download(backupFileName(), JSON.stringify(await exportBackup(), null, 2), 'application/json');
  }
  async function onBackupFile(f: File | undefined) {
    setError(''); setNotice('');
    if (!f) return;
    try {
      const text = await f.text();
      setPendingBackup({ text, count: parseBackup(text).subscriptions.length });
    } catch (e) { setError((e as Error).message); }
    if (backupRef.current) backupRef.current.value = '';
  }
  async function restore(mode: ImportMode) {
    if (!pendingBackup) return;
    if (mode === 'replace' && !confirm('Replace everything? All current subscriptions will be deleted and swapped for the backup.')) return;
    try {
      const { added, skipped } = await importBackup(pendingBackup.text, mode);
      setNotice(mode === 'replace' ? `Restored ${added} subscription${added === 1 ? '' : 's'} from backup.` : `Added ${added} from backup${skipped ? `, skipped ${skipped} already here` : ''}.`);
    } catch (e) { setError((e as Error).message); }
    setPendingBackup(null); load();
  }

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
      {notice && <p className="notice" role="status">{notice}</p>}

      {duplicateGroups.length > 0 && (
        <section className="card warn" aria-label="Possible duplicates">
          <h2>Possible duplicates</h2>
          <p className="muted">These look like the same subscription. Nothing is merged unless you click Merge.</p>
          {duplicateGroups.map(group => (
            <div className="dup-group" key={group.map(s => s.id).join('-')}>
              <ul className="plain">{group.map(s => <li key={s.id}><b>{s.name}</b> · {money(s.amount)} {s.cycle}{s.isTrial && ' (trial)'}</li>)}</ul>
              <div className="row-actions">
                <button className="link" onClick={() => dismissGroup(group)}>Dismiss</button>
                <button className="btn primary" onClick={() => mergeGroup(group)}>Merge {group.length}</button>
              </div>
            </div>
          ))}
        </section>
      )}

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
          <p className="muted">Untick anything that isn't a subscription.
            {(scanInfo.skipped > 0 || scanInfo.tracked > 0) && <> {[scanInfo.skipped ? `${scanInfo.skipped} row${scanInfo.skipped > 1 ? 's' : ''} skipped` : '', scanInfo.tracked ? `${scanInfo.tracked} already tracked` : ''].filter(Boolean).join(' · ')}.</>}
          </p>
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

      <section className="card">
        <h2>Backup</h2>
        <p className="muted">Save everything to a file you control, or restore it later. Nothing is uploaded.</p>
        <div className="actions">
          <button className="btn" onClick={downloadBackup}>Download backup</button>
          <label className="btn">Restore from backup
            <input ref={backupRef} type="file" accept=".json,application/json" hidden onChange={e => onBackupFile(e.target.files?.[0])} />
          </label>
        </div>
      </section>

      {pendingBackup && (
        <Modal onClose={() => setPendingBackup(null)} title="Restore from backup">
          <p>This backup contains <b>{pendingBackup.count}</b> subscription{pendingBackup.count === 1 ? '' : 's'}.</p>
          <p className="muted"><b>Merge</b> adds the ones you're missing and skips any that already exist. <b>Replace</b> deletes your current data first.</p>
          <div className="row-actions">
            <button className="btn" onClick={() => restore('replace')}>Replace…</button>
            <button className="btn primary" onClick={() => restore('merge')}>Merge</button>
          </div>
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
