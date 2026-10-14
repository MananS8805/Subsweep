import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from './db';
import { CURRENCIES } from './currency';
import { CATEGORIES, isLive, type Cycle, type Detected, type Subscription } from './types';
import { detectRecurring, monthlyCost, nextOnOrAfter, parseStatementDetailed } from './detect';
import { findDuplicates, groupPairKeys, isAlreadyTracked, mergeSubscriptions } from './dedupe';
import { backupFileName, exportBackup, importBackup, parseBackup, type ImportMode } from './backup';
import { buildIcs } from './ics';
import { cancelKit, cancelEmail, chatScript, disputeMessage, ctxOf, DIFFICULTY_LABEL } from './cancelKit';
import { applyCheck, cancelState, checkCancellations, type CancelState } from './zombie';
import Board from './Board';
import BrandLogo from './BrandLogo';
import CurrencySettings from './CurrencySettings';
import YearlyView, { type YearlySort } from './YearlyView';
import InsightCards from './InsightCards';
import { convert, formatMoney } from './currency';
import { DEFAULT_SETTINGS, loadSettings, saveSetting, type AppSettings } from './settings';
import { categoryYearly, missingCurrencies, monthlyBase, subCurrency, totals as calcTotals, yearlyCost } from './savings';
import { getInsights, visibleInsights, type Insight } from './insights';

const today = () => new Date().toISOString().slice(0, 10);
const daysUntil = (d: string) => Math.round((+new Date(d + 'T00:00:00Z') - +new Date(today() + 'T00:00:00Z')) / 86400000);
const blank = (currency: string): Subscription => ({ name: '', amount: 0, cycle: 'monthly', nextRenewal: today(), category: 'Other', isTrial: false, currency });

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
  const [view, setView] = useState<'board' | 'list' | 'yearly'>(() => (typeof window !== 'undefined' && window.innerWidth < 720 ? 'list' : 'board'));
  const [detail, setDetail] = useState<Subscription | null>(null);
  const [cancelFor, setCancelFor] = useState<Subscription | null>(null);
  const [textModal, setTextModal] = useState<{ title: string; text: string } | null>(null);
  const [scanInfo, setScanInfo] = useState({ skipped: 0, tracked: 0 });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [yearlySort, setYearlySort] = useState<YearlySort>('yearly');
  const [pendingBackup, setPendingBackup] = useState<{ text: string; count: number } | null>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [notifState, setNotifState] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = settings.baseCurrency, rates = settings.rates;
  const money = (n: number, currency?: string) => formatMoney(n, currency ?? base);

  const load = async () => {
    setSettings(await loadSettings());
    setSubs(await db.subs.orderBy('nextRenewal').toArray());
    setDismissed((await db.dismissedDuplicates.toArray()).map(d => d.key));
  };
  useEffect(() => { load(); }, []);

  // Roll past renewal dates forward, and fire in-page reminders for anything due within 3 days.
  useEffect(() => {
    if (!subs.length) return;
    (async () => {
      for (const s of subs.filter(isLive)) {
        const rolled = s.isTrial ? s.nextRenewal : nextOnOrAfter(s.nextRenewal, s.cycle);
        if (rolled !== s.nextRenewal) await db.subs.update(s.id!, { nextRenewal: rolled });
      }
    })();
    if (notifState === 'granted') {
      const key = 'subsweep-notified-' + today();
      if (!localStorage.getItem(key)) {
        const due = subs.filter(s => isLive(s) && daysUntil(s.nextRenewal) >= 0 && daysUntil(s.nextRenewal) <= 3);
        due.forEach(s => new Notification(`${s.isTrial ? 'Trial ends' : 'Renews'} soon: ${s.name}`, { body: `${money(s.amount, s.currency)} on ${s.nextRenewal}` }));
        localStorage.setItem(key, '1');
      }
    }
  }, [subs.length, notifState]);

  const stateOf = (s: Subscription): CancelState => cancelState(s, today());
  const tot = useMemo(() => calcTotals(subs, base, rates), [subs, base, rates]);
  const monthly = tot.monthly;
  const needRates = useMemo(() => missingCurrencies(subs.filter(isLive), base, rates), [subs, base, rates]);
  const saved = useMemo(() => {
    let verified = 0, pending = 0;
    for (const s of subs) {
      const st = cancelState(s, today());
      const yearly = yearlyCost({ ...s, isTrial: false }, base, rates) ?? 0;
      if (st === 'verified') verified += yearly;
      else if (st === 'cancelling' || st === 'awaiting') pending += yearly;
    }
    return { verified, pending };
  }, [subs, base, rates]);
  const zombies = subs.filter(s => s.zombieCharges?.length);
  const byCat = useMemo(() => categoryYearly(subs, base, rates).map(([c, y]) => [c, y / 12] as [string, number]), [subs, base, rates]);
  const insights = useMemo(
    () => visibleInsights(getInsights(subs, today(), { base, rates }), settings.dismissedInsights),
    [subs, base, rates, settings.dismissedInsights]);
  const duplicateGroups = useMemo(() => findDuplicates(subs, dismissed), [subs, dismissed]);
  const upcoming = subs.filter(s => isLive(s) && daysUntil(s.nextRenewal) <= 7 && daysUntil(s.nextRenewal) >= 0);

  async function onFile(f: File | undefined) {
    setError(''); setNotice('');
    if (!f) return;
    try {
      const { txns, skippedRows } = parseStatementDetailed(await f.text());
      const cancelMsgs: string[] = [];
      for (const c of checkCancellations(txns, subs)) {
        const patch = applyCheck(c, today());
        if (!patch) continue;
        const name = subs.find(x => x.id === c.id)!.name;
        await db.subs.update(c.id, patch);
        cancelMsgs.push(c.outcome === 'verified' ? `Verified: ${name} is no longer charging you.` : `Still charging: ${name} billed you after you cancelled.`);
      }
      if (cancelMsgs.length) { await load(); }
      const all = detectRecurring(txns);
      const det = all.filter(d => !isAlreadyTracked(d.name, subs));
      const tracked = all.length - det.length;
      const info = [skippedRows ? `${skippedRows} row${skippedRows > 1 ? 's' : ''} skipped` : '', tracked ? `${tracked} already tracked` : ''].filter(Boolean).join(' · ');
      setScanInfo({ skipped: skippedRows, tracked });
      if (cancelMsgs.length) setNotice(cancelMsgs.join(' '));
      if (!det.length) {
        if (tracked && !cancelMsgs.length) setNotice(`Nothing new to add. ${info}.`);
        else if (!tracked && !cancelMsgs.length) setError(`No recurring charges found. Statements covering 3+ months work best.${skippedRows ? ` ${info}.` : ''}`);
      }
      setFound(det.length ? det.map(d => ({ ...d, keep: true })) : null);
    } catch (e) { setError((e as Error).message); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function importFound() {
    const rows = (found ?? []).filter(d => d.keep).map<Subscription>(d => ({
      name: d.name, amount: d.amount, cycle: d.cycle, nextRenewal: d.nextRenewal,
      category: guessCategory(d.name), isTrial: false, priceCreep: d.priceCreep, createdAt: new Date().toISOString(), currency: d.currency ?? base,
    }));
    await db.subs.bulkAdd(rows);
    setFound(null); load();
  }

  async function save(s: Subscription) {
    if (!s.name.trim() || !(s.amount > 0)) return;
    const row = { ...s, currency: s.currency ?? base };
    row.id ? await db.subs.put(row) : await db.subs.add({ ...row, createdAt: new Date().toISOString() });
    setEditing(null); load();
  }
  async function remove(id: number) { if (confirm('Remove this subscription?')) { await db.subs.delete(id); load(); } }

  async function startCancel(s: Subscription, f: { requestedAt: string; effectiveDate: string; ref: string }) {
    const { verifiedAt: _v, ...rest } = s;
    await db.subs.put({ ...rest, status: 'cancelling', cancelRequestedAt: f.requestedAt, cancelEffectiveDate: f.effectiveDate, cancelRef: f.ref.trim() || undefined, zombieCharges: [] });
    setCancelFor(null); setDetail(null); load();
  }
  async function keepSubscription(s: Subscription) {
    const { status: _s, cancelRequestedAt: _a, cancelEffectiveDate: _b, cancelRef: _c, verifiedAt: _d, zombieCharges: _e, ...rest } = s;
    await db.subs.put(rest);
    setDetail(null); load();
  }
  async function resolveZombie(s: Subscription) {
    await db.subs.update(s.id!, { zombieCharges: [], verifiedAt: undefined });
    setDetail(null); load();
  }
  const showDispute = (s: Subscription) => setTextModal({ title: `Dispute message: ${s.name}`, text: disputeMessage(ctxOf(s), s.zombieCharges ?? []) });

  async function changeBase(code: string) {
    if (code === base) return;
    await db.settings.bulkPut([{ key: 'baseCurrency', value: code }, { key: 'ratesNeedReview', value: true }]);
    await load();
  }
  async function changeRate(code: string, rate: number | null) {
    const next = { ...rates };
    if (rate === null) delete next[code]; else next[code] = rate;
    await saveSetting('rates', next);
    await load();
  }
  async function ratesReviewed() { await saveSetting('ratesNeedReview', false); await load(); }

  async function toggleSelect(s: Subscription) { await db.subs.update(s.id!, { selectedForCancel: !s.selectedForCancel }); await load(); }
  async function clearSelection() {
    const ids = subs.filter(s => s.selectedForCancel).map(s => s.id!);
    await db.transaction('rw', db.subs, async () => { for (const id of ids) await db.subs.update(id, { selectedForCancel: false }); });
    await load();
  }
  async function markUsed(id: number) { await db.subs.update(id, { lastUsedAt: today() }); await load(); }
  async function dismissInsight(id: string) {
    await saveSetting('dismissedInsights', [...new Set([...settings.dismissedInsights, id])]);
    await load();
  }
  async function reviewInsight(i: Insight) {
    await db.transaction('rw', db.subs, async () => { for (const id of i.subIds) await db.subs.update(id, { selectedForCancel: true }); });
    await load();
    setView('yearly');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const goToRates = () => document.getElementById('currency-settings')?.scrollIntoView({ behavior: 'smooth' });

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

  const cycleShort = (c: Cycle) => ({ weekly: 'wk', monthly: 'mo', quarterly: 'qtr', yearly: 'yr' })[c];
  const scanInfoText = [scanInfo.skipped ? `${scanInfo.skipped} row${scanInfo.skipped > 1 ? 's' : ''} skipped` : '', scanInfo.tracked ? `${scanInfo.tracked} already tracked` : ''].filter(Boolean).join(' · ');

  return (
    <div className="app">
      <header className="top">
        <h1>SUBSWEEP</h1>
        <nav className="actions" aria-label="Actions">
          <label className="btn primary">Scan statement ↗
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0])} />
          </label>
          <button className="btn" onClick={() => setEditing(blank(base))}>+ Add</button>
          <button className="btn" disabled={!subs.some(isLive)} onClick={() => download('subsweep-renewals.ics', buildIcs(subs), 'text/calendar')}>Calendar</button>
          {notifState === 'default' && <button className="btn" onClick={askNotif}>Reminders</button>}
        </nav>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <InsightCards insights={insights} money={n => money(n)} onDismiss={dismissInsight} onReview={reviewInsight} onUsed={i => markUsed(i.subIds[0])} />

      <div className="view-switch" role="tablist" aria-label="View">
        <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Explore</button>
        <button role="tab" aria-selected={view === 'yearly'} className={view === 'yearly' ? 'on' : ''} onClick={() => setView('yearly')}>Yearly</button>
        <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
      </div>

      {view === 'board' && (
        <Board subs={subs} monthly={monthly} saved={saved} stateOf={stateOf} costOf={s => monthlyBase(s, base, rates) ?? 0} money={money} daysUntil={daysUntil} onOpen={setDetail} onScan={() => fileRef.current?.click()} />
      )}

      {view === 'list' && (
        <section className="summary">
          <div className="stat"><span>Per month</span><strong>{money(monthly)}</strong></div>
          <div className="stat"><span>Per year</span><strong>{money(tot.yearly)}</strong></div>
          <div className="stat"><span>Active</span><strong>{subs.filter(s => isLive(s) && !s.isTrial).length}</strong></div>
          {saved.verified > 0 && <div className="stat"><span>Saved / year</span><strong>{money(saved.verified)}</strong></div>}
        </section>
      )}

      {view === 'yearly' && (
        <YearlyView subs={subs} base={base} rates={rates} money={money} sort={yearlySort} onSort={setYearlySort}
          onToggle={toggleSelect} onClear={clearSelection} onUsed={s => markUsed(s.id!)} onOpen={setDetail} />
      )}

      {needRates.length > 0 && view !== 'yearly' && (
        <section className="card warn" aria-label="Exchange rate needed">
          <h2>Exchange rate needed</h2>
          <p className="muted">{tot.missing.length} subscription{tot.missing.length === 1 ? ' is' : 's are'} left out of your totals because there is no rate for {needRates.join(', ')}.</p>
          <div className="row-actions"><button className="btn primary" onClick={goToRates}>Set rates</button></div>
        </section>
      )}
      {settings.ratesNeedReview && (
        <p className="notice" role="status">Base currency changed to {base}. Please review your exchange rates. <button className="link" onClick={goToRates}>Review rates</button></p>
      )}

      {zombies.length > 0 && (
        <section className="card danger" aria-label="Still being charged">
          <h2>Still being charged</h2>
          <p className="muted">These were cancelled, but your statement shows charges after the paid period ended.</p>
          {zombies.map(s => (
            <div className="dup-group" key={s.id}>
              <div className="with-logo"><BrandLogo name={s.name} size={34} />
                <span><b>{s.name}</b> · {s.zombieCharges!.map(c => `${money(c.amount, s.currency)} on ${c.date}`).join(', ')}<br /><small className="muted">You cancelled {s.cancelRequestedAt}{s.cancelEffectiveDate && `, paid through ${s.cancelEffectiveDate}`}.</small></span></div>
              <div className="row-actions">
                <button className="link" onClick={() => resolveZombie(s)}>Mark resolved</button>
                <button className="btn primary" onClick={() => showDispute(s)}>Dispute message</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {duplicateGroups.length > 0 && (
        <section className="card warn" aria-label="Possible duplicates">
          <h2>Possible duplicates</h2>
          <p className="muted">These look like the same subscription. Nothing is merged unless you click Merge.</p>
          {duplicateGroups.map(group => (
            <div className="dup-group" key={group.map(s => s.id).join('-')}>
              <ul className="plain">{group.map(s => <li key={s.id} className="with-logo"><BrandLogo name={s.name} size={30} /><span><b>{s.name}</b> · {money(s.amount, s.currency)} {s.cycle}{s.isTrial && ' (trial)'}</span></li>)}</ul>
              <div className="row-actions">
                <button className="link" onClick={() => dismissGroup(group)}>Dismiss</button>
                <button className="btn primary" onClick={() => mergeGroup(group)}>Merge {group.length}</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {view !== 'yearly' && upcoming.length > 0 && (
        <section aria-label="Renewing in the next 7 days">
          <h2>Renewing this week</h2>
          <div className="chips">
            {upcoming.map(s => (
              <button key={s.id} className="chip" onClick={() => setDetail(s)}>
                <BrandLogo name={s.name} size={34} />
                <span><b>{s.name}</b><small>{money(s.amount, s.currency)} · {daysUntil(s.nextRenewal) === 0 ? 'today' : `in ${daysUntil(s.nextRenewal)}d`}{s.isTrial && ' · trial ends'}</small></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {view !== 'yearly' && byCat.length > 0 && (
        <section className="card">
          <h2>By category · monthly</h2>
          {byCat.map(([c, v]) => (
            <div className="bar-row" key={c}>
              <span>{c}</span>
              <div className="bar"><div style={{ width: `${(v / byCat[0][1]) * 100}%` }} /></div>
              <span className="amt">{money(v)}</span>
            </div>
          ))}
        </section>
      )}

      {view !== 'yearly' && <section aria-label="All subscriptions">
        <h2>All subscriptions</h2>
        {subs.length === 0 && <p className="empty">Nothing yet. Upload a statement CSV from your bank, or add a subscription by hand.</p>}
        {subs.map(s => (
          <article className="card sub" key={s.id}>
            <div className="row">
              <div className="with-logo">
                <BrandLogo name={s.name} size={48} />
                <div>
                  <h3>{s.name} {s.isTrial && <span className="pill trial">trial</span>}{stateOf(s) !== 'active' && <span className={`pill st-${stateOf(s)}`}>{STATE_LABEL[stateOf(s)]}</span>}</h3>
                  <p className="muted">{s.category} · {s.cycle} · next {s.nextRenewal} ({daysUntil(s.nextRenewal)}d)</p>
                  {s.priceCreep && <p className="creep">Price crept up: {money(s.priceCreep.from, s.currency)} → {money(s.priceCreep.to, s.currency)}</p>}
                </div>
              </div>
              <div className="price">{money(s.amount, s.currency)}<small>/{cycleShort(s.cycle)}</small>
                <Converted s={s} base={base} rates={rates} money={money} onSetRate={goToRates} />
              </div>
            </div>
            {isLive(s) && <details><summary>How to cancel</summary><p className="muted">{cancelKit(s.name).steps}</p></details>}
            <div className="row-actions">
              <button className="link" onClick={() => setDetail(s)}>{isLive(s) ? 'Cancel…' : 'Status'}</button>
              <button className="link" onClick={() => setEditing(s)}>Edit</button>
              <button className="link danger" onClick={() => remove(s.id!)}>Remove</button>
            </div>
          </article>
        ))}
      </section>}

      {found && (
        <Modal onClose={() => setFound(null)} title={`Found ${found.length} recurring charge${found.length > 1 ? 's' : ''}`}>
          <p className="muted">Untick anything that isn't a subscription.{scanInfoText && ` ${scanInfoText}.`}</p>
          <ul className="plain">
            {found.map((d, i) => (
              <li key={d.name}>
                <label className="with-logo"><input type="checkbox" checked={d.keep} onChange={e => setFound(found.map((x, j) => j === i ? { ...x, keep: e.target.checked } : x))} />
                  <BrandLogo name={d.name} size={34} />
                  <span><b>{d.name}</b> · {money(d.amount, d.currency)} {d.cycle} · seen {d.occurrences}×{d.priceCreep && <span className="creep"> · price up {money(d.priceCreep.from, d.currency)}→{money(d.priceCreep.to, d.currency)}</span>}</span></label>
              </li>
            ))}
          </ul>
          <button className="btn primary" onClick={importFound}>Add selected</button>
        </Modal>
      )}

      {detail && (
        <Modal onClose={() => setDetail(null)} title={detail.name}>
          <div className="detail-head">
            <BrandLogo name={detail.name} size={72} />
            <div>
              <div className="price">{money(detail.amount, detail.currency)}<small>/{cycleShort(detail.cycle)}</small></div>
              <p className="muted">{detail.category} · {detail.cycle}{detail.isTrial && ' · free trial'}</p>
            </div>
          </div>
          <p>Next {detail.isTrial ? 'trial end' : 'renewal'}: <b>{detail.nextRenewal}</b> ({daysUntil(detail.nextRenewal)}d)</p>
          {(() => { const m = monthlyBase({ ...detail, isTrial: false }, base, rates);
            return m === null
              ? <p className="error">Set an exchange rate for {subCurrency(detail, base)} to see what this costs in {base}. <button className="link" onClick={() => { setDetail(null); goToRates(); }}>Set rate</button></p>
              : <p className="muted">That's about {money(m)} a month, {money(m * 12)} a year{detail.isTrial ? ' once the trial converts' : ''}.</p>; })()}
          {detail.lastUsedAt && <p className="muted">You last marked this used on {detail.lastUsedAt}.</p>}
          {detail.priceCreep && <p className="creep">Price crept up: {money(detail.priceCreep.from, detail.currency)} → {money(detail.priceCreep.to, detail.currency)}</p>}
          <DetailStatus s={detail} state={stateOf(detail)} money={n => money(n, detail.currency)} />
          {isLive(detail) && (() => { const k = cancelKit(detail.name); return (
            <details open><summary>How to cancel</summary>
              <p className="muted">{k.steps}</p>
              <p className="muted"><span className={`pill diff-${k.difficulty}`}>{DIFFICULTY_LABEL[k.difficulty]}</span>{k.note && ` ${k.note}`}</p>
            </details>); })()}
          <div className="row-actions">
            <button className="link danger" onClick={async () => { const id = detail.id!; setDetail(null); await remove(id); }}>Remove</button>
            {isLive(detail) ? <>
              <button className="btn" onClick={async () => { await markUsed(detail.id!); setDetail(null); }}>Used recently</button>
              <button className="btn" onClick={() => { setCancelFor(detail); setDetail(null); }}>Start cancelling</button>
              <button className="btn primary" onClick={() => { setEditing(detail); setDetail(null); }}>Edit</button>
            </> : <>
              {stateOf(detail) === 'zombie' && <button className="btn primary" onClick={() => showDispute(detail)}>Dispute message</button>}
              <button className="btn" onClick={() => keepSubscription(detail)}>Keep subscription</button>
            </>}
          </div>
        </Modal>
      )}

      <CurrencySettings base={base} rates={rates} subs={subs} needReview={settings.ratesNeedReview}
        onBase={changeBase} onRate={changeRate} onReviewed={ratesReviewed} />

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

      {cancelFor && <CancelFlow sub={cancelFor} onSave={f => startCancel(cancelFor, f)} onClose={() => setCancelFor(null)} onText={(title, text) => setTextModal({ title, text })} />}
      {textModal && <TextModal title={textModal.title} text={textModal.text} onClose={() => setTextModal(null)} />}
      {editing && <EditForm sub={editing} base={base} onSave={save} onCancel={() => setEditing(null)} />}
      <footer>Local-only · no accounts · no tracking · logos are bundled, never fetched. Always confirm cancellation steps on the provider's site.</footer>
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

const STATE_LABEL: Record<CancelState, string> = { active: '', cancelling: 'cancelling', awaiting: 'unverified', verified: 'verified ✓', zombie: 'still charging' };

function DetailStatus({ s, state, money }: { s: Subscription; state: CancelState; money: (n: number) => string }) {
  if (state === 'active') return null;
  const yearly = money(monthlyCost(s.amount, s.cycle) * 12);
  const text: Record<Exclude<CancelState, 'active'>, string> = {
    cancelling: `Cancelling. Stays active until ${s.cancelEffectiveDate}. Scan a statement after that date and SubSweep will check the charges stopped.`,
    awaiting: `The paid period ended ${s.cancelEffectiveDate}. Scan a newer statement (covering a full billing cycle after it) to verify no more charges.`,
    verified: `Verified cancelled on ${s.verifiedAt}. That is ${yearly} a year you are no longer paying.`,
    zombie: `Still being charged: ${(s.zombieCharges ?? []).map(c => `${money(c.amount)} on ${c.date}`).join(', ')}.`,
  };
  return <p className={state === 'zombie' ? 'error' : state === 'verified' ? 'notice' : 'muted'}>{text[state]}{s.cancelRef && <><br /><small>Reference: {s.cancelRef}</small></>}</p>;
}

function CancelFlow({ sub, onSave, onClose, onText }: { sub: Subscription; onSave: (f: { requestedAt: string; effectiveDate: string; ref: string }) => void; onClose: () => void; onText: (title: string, text: string) => void }) {
  const [requestedAt, setRequestedAt] = useState(today());
  const [effectiveDate, setEffectiveDate] = useState(sub.nextRenewal);
  const [ref, setRef] = useState('');
  const kit = cancelKit(sub.name);
  const ctx = { name: sub.name, amount: sub.amount, requestedAt, effectiveDate, ref };
  return (
    <Modal title={`Cancel ${sub.name}`} onClose={onClose}>
      <p className="muted"><span className={`pill diff-${kit.difficulty}`}>{DIFFICULTY_LABEL[kit.difficulty]}</span> {kit.steps}</p>
      {kit.note && <p className="muted">{kit.note}</p>}
      {kit.link && <p><a className="btn" href={kit.link} target="_blank" rel="noopener noreferrer">Open {sub.name} account page ↗</a></p>}
      <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn" onClick={() => onText('Cancellation email', cancelEmail(ctx))}>Email template</button>
        <button type="button" className="btn" onClick={() => onText('Chat script', chatScript(ctx))}>Chat script</button>
      </div>
      <form className="form" onSubmit={e => { e.preventDefault(); onSave({ requestedAt, effectiveDate, ref }); }}>
        <p className="muted">After you cancel, record it here. When you scan a later statement, SubSweep checks that the charges really stopped.</p>
        <label>Date you cancelled<input required type="date" value={requestedAt} onChange={e => setRequestedAt(e.target.value)} /></label>
        <label>Paid through (last day you are covered)<input required type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></label>
        <label>Confirmation number or note (optional)<input value={ref} onChange={e => setRef(e.target.value)} /></label>
        <div className="row-actions"><button type="button" className="btn" onClick={onClose}>Back</button><button className="btn primary">I've cancelled it</button></div>
      </form>
      <p className="muted"><small>Always confirm the steps on the provider's site. Message templates are not legal advice.</small></p>
    </Modal>
  );
}

function TextModal({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { area.current?.select(); setCopied(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <textarea ref={area} className="textbox" readOnly value={text} rows={12} onFocus={e => e.currentTarget.select()} />
      <div className="row-actions"><button className="btn primary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button></div>
    </Modal>
  );
}

/** The amount in the base currency, in small text, when a subscription is billed in something else. */
function Converted({ s, base, rates, money, onSetRate }: { s: Subscription; base: string; rates: Record<string, number>; money: (n: number, c?: string) => string; onSetRate: () => void }) {
  const cur = subCurrency(s, base);
  if (cur === base) return null;
  const c = convert(s.amount, cur, base, rates);
  return c === null
    ? <button className="pill st-zombie linkpill" onClick={onSetRate} title={`Set a rate for ${cur}`}>set rate</button>
    : <small className="block">≈ {money(c)}</small>;
}

function EditForm({ sub, base, onSave, onCancel }: { sub: Subscription; base: string; onSave: (s: Subscription) => void; onCancel: () => void }) {
  const [s, setS] = useState(sub);
  const set = <K extends keyof Subscription>(k: K, v: Subscription[K]) => setS(p => ({ ...p, [k]: v }));
  return (
    <Modal title={sub.id ? 'Edit subscription' : 'Add subscription'} onClose={onCancel}>
      <form onSubmit={e => { e.preventDefault(); onSave({ ...s, currency: s.currency ?? base, category: s.category || guessCategory(s.name) }); }} className="form">
        <label>Name<input required value={s.name} onChange={e => set('name', e.target.value)} /></label>
        <div className="two">
          <label>Amount<input required type="number" min="0.01" step="0.01" value={s.amount || ''} onChange={e => set('amount', +e.target.value)} /></label>
          <label>Currency
            <select value={s.currency ?? base} onChange={e => set('currency', e.target.value)}>
              {[...new Set([s.currency ?? base, base, ...CURRENCIES.map(c => c.code)])].map(c => <option key={c}>{c}</option>)}
            </select></label>
        </div>
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
