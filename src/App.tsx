import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from './db';
import { CURRENCIES } from './currency';
import { CATEGORIES, CYCLES, CYCLE_LABEL, CYCLE_SHORT, isLive, type Cycle, type Subscription } from './types';
import { confidenceLabel, detectRecurring, monthlyCost, nextOnOrAfter, parseStatementDetailed } from './detect';
import { findDuplicates, groupPairKeys, mergeSubscriptions } from './dedupe';
import { backupFileName, exportBackup, importBackup, type ImportMode } from './backup';
import { buildIcs } from './ics';
import { cancelKit, cancelEmail, chatScript, disputeMessage, ctxOf, DIFFICULTY_LABEL } from './cancelKit';
import { applyCheck, cancelState, checkCancellations, type CancelState } from './zombie';
import Board from './Board';
import BrandLogo from './BrandLogo';
import CurrencySettings from './CurrencySettings';
import YearlyView, { type YearlySort } from './YearlyView';
import InsightCards from './InsightCards';
import LiveRegion from './LiveRegion';
import AppSettingsCard from './AppSettings';
import { applyUpdate, promptInstall, usePwa } from './pwa';
import { loadSampleData, removeSampleData, SAMPLE_BATCH } from './sampleData';
import { modalDepth, nextTabIndex } from './a11y';
import Modal from './Modal';
import Toast from './Toast';
import ImportReview from './ImportReview';
import ReminderMenu, { reminderStatus } from './ReminderMenu';
import ReminderSettings from './ReminderSettings';
import BulkBar from './BulkBar';
import ConfirmDialog from './ConfirmDialog';
import DigestView from './DigestView';
import PriceChart from './PriceChart';
import { canApply, doneMessage, needsDeleteConfirm, undoMessage, type BulkAction } from './bulk';
import { runBulk, runUndo } from './bulkDb';
import { digestText, getDigest } from './digest';
import { addedMessage, buildPreview, idsInBatch, newBatchId, selectedItems, toSubscriptions, type PreviewItem } from './importPreview';
import { freshReminders, getDueReminders, notificationText, soonestLabel, staleKeys, whenText } from './reminders';
import { dayDiff, localDate } from './dates';
import { convert, formatMoney } from './currency';
import { DEFAULT_SETTINGS, loadSettings, saveSetting, type AppSettings } from './settings';
import { categoryYearly, missingCurrencies, monthlyBase, subCurrency, totals as calcTotals, yearlyCost } from './savings';
import { getInsights, visibleInsights, type Insight } from './insights';
import RestorePreview from './RestorePreview';
import QuickAdd from './QuickAdd';
import ShortcutHelp from './ShortcutHelp';
import ReviewDialog from './ReviewDialog';
import { useShortcuts, type ShortcutAction } from './shortcuts';
import { decisionPatch, getReviewQueue, shouldPromptReview, snoozeUntil, type ReviewDecision } from './review';
import { NOTES_MAX, normalizeNotes, validateSubscription } from './validate';
import PaymentField from './PaymentField';
import PaymentBreakdown from './PaymentBreakdown';
import MethodDialog from './MethodDialog';
import Welcome from './Welcome';
import EmptyState from './EmptyState';
import { canonicalLabel, listMethods, matchesMethod, normalizeLabel, totalsByMethod } from './paymentMethods';
import { csvFileName, digestToCsv, hasDataRows, subscriptionsToCsv } from './exportCsv';
import { isSample, shouldShowOnboarding } from './onboarding';

const today = () => localDate(); // the user's local calendar date, never UTC
const daysUntil = (d: string) => dayDiff(today(), d);
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

const VIEWS = [['board', 'Explore'], ['yearly', 'Yearly'], ['digest', 'Next 30 days'], ['list', 'List']] as const;

export default function App() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [toast, setToast] = useState<{ id: number; message: string; actionLabel: string; durationMs: number; onAction: () => void } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'board' | 'list' | 'yearly' | 'digest'>(() => (typeof window !== 'undefined' && window.innerWidth < 720 ? 'list' : 'board'));
  const [detail, setDetail] = useState<Subscription | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  const [chartFor, setChartFor] = useState<Subscription | null>(null);
  const [cancelFor, setCancelFor] = useState<Subscription | null>(null);
  const [textModal, setTextModal] = useState<{ title: string; text: string } | null>(null);
  const [scanInfo, setScanInfo] = useState({ skipped: 0, tracked: 0 });
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [yearlySort, setYearlySort] = useState<YearlySort>('yearly');
  const [pendingBackup, setPendingBackup] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<Subscription[] | null>(null);
  const [filter, setFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [methodDialog, setMethodDialog] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [notifState, setNotifState] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = settings.baseCurrency, rates = settings.rates;
  const money = (n: number, currency?: string) => formatMoney(n, currency ?? base);

  const load = async () => {
    setSettings(await loadSettings());
    setSubs(await db.subs.orderBy('nextRenewal').toArray());
    setDismissed((await db.dismissedDuplicates.toArray()).map(d => d.key));
    setLoaded(true);
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
    }, [subs.length]);

  // Reminders: window-aware, and each (subscription, renewal date, window) is shown at most once. The check-and-record
  // runs in one transaction, so two quick runs (React StrictMode, a fast re-render) can never both fire it.
  useEffect(() => {
    if (!subs.length || notifState !== 'granted') return;
    (async () => {
      const due = getDueReminders(subs, settings, today());
      if (!due.length) return;
      const fresh = await db.transaction('rw', db.notifiedReminders, async () => {
        const rows = await db.notifiedReminders.toArray();
        const toShow = freshReminders(due, rows.map(r => r.key));
        await db.notifiedReminders.bulkPut(toShow.map(d => ({ key: d.key, renewalDate: d.sub.nextRenewal, at: new Date().toISOString() })));
        await db.notifiedReminders.bulkDelete(staleKeys(rows, today()));
        return toShow;
      });
      for (const r of fresh) { const t = notificationText(r, money(r.sub.amount, r.sub.currency)); new Notification(t.title, { body: t.body }); }
    })().catch(err => console.warn('SubSweep: could not show reminders', err));
  }, [subs, settings.reminderDays, notifState]);

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
  const visibleSubs = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return subs.filter(s => (!q || s.name.toLowerCase().includes(q)) && matchesMethod(s, methodFilter));
  }, [subs, filter, methodFilter]);
  const methods = useMemo(() => listMethods(subs), [subs]);
  const methodRows = useMemo(() => totalsByMethod(subs, { baseCurrency: base, rates }), [subs, base, rates]);
  const showWelcome = loaded && shouldShowOnboarding(subs.length, settings);
  // a filter whose label no longer exists (last item with it was deleted) falls back to All
  useEffect(() => { if (methodFilter !== 'all' && methodFilter !== 'none' && !methods.some(m => m.label.toLowerCase() === methodFilter.toLowerCase())) setMethodFilter('all'); }, [methods, methodFilter]);
  // the welcome panel never comes back once there has been a subscription (added, imported, restored or sample)
  useEffect(() => { if (loaded && subs.length > 0 && !settings.onboardingDismissed) saveSetting('onboardingDismissed', true).then(load); }, [loaded, subs.length, settings.onboardingDismissed]); // "Select all" only ever covers what the list is showing
  const dueReview = useMemo(() => getReviewQueue(subs, today(), base, rates), [subs, base, rates]);
  const promptReview = shouldPromptReview(dueReview.length, settings.reviewPromptDismissedUntil, today());
  const digest = useMemo(() => getDigest(subs, settings, today()), [subs, settings.baseCurrency, settings.rates]);
  const dueList = useMemo(() => getDueReminders(subs, settings, today()), [subs, settings.reminderDays]);

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
      const items = buildPreview(detectRecurring(txns), subs, guessCategory, base);
      const tracked = items.filter(i => i.alreadyTracked).length;
      const fresh = items.length - tracked;
      setScanInfo({ skipped: skippedRows, tracked });
      if (cancelMsgs.length) setNotice(cancelMsgs.join(' '));
      if (!items.length) {
        if (!cancelMsgs.length) setError(`No recurring charges found. Statements covering 3+ months work best.${skippedRows ? ` ${skippedRows} row${skippedRows > 1 ? 's' : ''} skipped.` : ''}`);
      } else if (!fresh) {
        if (!cancelMsgs.length) setNotice(`Nothing new to add. ${tracked} already tracked${skippedRows ? ` · ${skippedRows} row${skippedRows > 1 ? 's' : ''} skipped` : ''}.`);
      } else {
        setPreview(items); // review first; nothing is written until the user adds it
      }
    } catch (e) { setError((e as Error).message); }
    if (fileRef.current) fileRef.current.value = '';
  }

  function showToast(message: string, actionLabel: string, durationMs: number, onAction: () => void) {
    setToast({ id: Date.now(), message, actionLabel, durationMs, onAction });
    setNotice(message); // announced politely by the live region; the toast itself is not a live region
  }

  async function addFromPreview() {
    if (!preview) return;
    const batch = newBatchId();
    const rows = toSubscriptions(preview, batch, new Date().toISOString(), today());
    if (!rows.length) return;
    await db.subs.bulkAdd(rows);
    setPreview(null);
    await load();
    showToast(addedMessage(rows.length), 'Undo', 30000, async () => {
      // remove exactly the rows this import added, and nothing else
      const ids = idsInBatch(await db.subs.toArray(), batch);
      await db.subs.bulkDelete(ids);
      setToast(null); setNotice(`Undid the import: removed ${ids.length} subscription${ids.length === 1 ? '' : 's'}.`);
      await load();
    });
  }

  async function save(s: Subscription): Promise<string | null> {
    const problem = validateSubscription(s);
    if (problem) return problem;
    const row: Subscription = { ...s, name: s.name.trim(), notes: normalizeNotes(s.notes), paymentMethod: canonicalLabel(s.paymentMethod ?? '', subs.filter(x => x.id !== s.id)), currency: s.currency ?? base };
    if (row.notes === undefined) delete row.notes;
    if (!row.paymentMethod) delete row.paymentMethod;
    row.id ? await db.subs.put(row) : await db.subs.add({ ...row, createdAt: new Date().toISOString() });
    setEditing(null); setQuickAdd(false); load();
    return null;
  }

  function onShortcut(a: ShortcutAction) {
    switch (a) {
      case 'add': setQuickAdd(true); break;
      case 'help': setShowHelp(true); break;
      case 'filter':
        if (view !== 'list' && view !== 'board') setView('list');
        setTimeout(() => filterRef.current?.focus(), 0);
        break;
      case 'review': startReview(); break;
      case 'go-board': setView('board'); break;
      case 'go-yearly': setView('yearly'); break;
      case 'go-digest': setView('digest'); break;
      case 'go-list': setView('list'); break;
    }
  }
  useShortcuts(onShortcut);

  function startReview() {
    setReviewQueue(dueReview);
  }
  async function decideReview(s: Subscription, d: ReviewDecision) {
    const patch = decisionPatch(d, today());
    if (Object.keys(patch).length) await db.subs.update(s.id!, patch);
  }
  async function finishReview(counts: Record<ReviewDecision, number>) {
    const reviewed = reviewQueue ?? [];
    setReviewQueue(null);
    await load();
    const n = counts.keep + counts.cancel;
    if (!n) return;
    const prior = reviewed.map(r => ({ id: r.id!, lastReviewedAt: r.lastReviewedAt, selectedForCancel: r.selectedForCancel }));
    showToast(`Reviewed ${n} subscription${n === 1 ? '' : 's'}.`, 'Undo', 15000, async () => {
      // put back exactly what was there before; only rows the review touched are in `prior`, skipped ones were never changed
      await db.transaction('rw', db.subs, async () => {
        for (const p of prior) if (await db.subs.get(p.id)) await db.subs.update(p.id, { lastReviewedAt: p.lastReviewedAt, selectedForCancel: p.selectedForCancel });
      });
      setToast(null); setNotice('Undid the review.');
      await load();
    });
  }
  async function snoozeReviewPrompt() { await saveSetting('reviewPromptDismissedUntil', snoozeUntil(today())); await load(); }
  async function markReviewed(s: Subscription) {
    const prev = s.lastReviewedAt;
    await db.subs.update(s.id!, { lastReviewedAt: today() });
    await load();
    showToast(`Marked ${s.name} reviewed.`, 'Undo', 10000, async () => {
      await db.subs.update(s.id!, { lastReviewedAt: prev });
      setToast(null); setNotice(`Undid: ${s.name} is not marked reviewed.`);
      await load();
    });
  }
  // forget selected ids that no longer exist (deleted elsewhere, or by undo bookkeeping)
  useEffect(() => {
    setSelected(prev => {
      const live = new Set(subs.map(x => x.id));
      const next = new Set([...prev].filter(id => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [subs]);
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && modalDepth() === 0) exitSelectMode(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectMode]);

  function enterSelectMode() { setSelectMode(true); setSelected(new Set()); setNotice('Select mode on. Tick subscriptions, then use the actions bar.'); }
  function exitSelectMode() {
    setSelectMode(false); setSelected(new Set());
    document.getElementById('select-toggle')?.focus();
  }
  const toggleOne = (id: number) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /** Run a bulk action, then offer Undo for 15 seconds. Selection is cleared afterwards. */
  async function doBulk(action: BulkAction) {
    const ids = [...selected];
    if (!canApply(ids)) return;
    const plan = await runBulk(subs, ids, action);
    setSelected(new Set());
    await load();
    if (!plan.changed) { setNotice('Nothing to change: they were already set that way.'); return; }
    showToast(doneMessage(action, plan.changed), 'Undo', 15000, async () => {
      const r = await runUndo(plan.undo);
      setToast(null); setNotice(undoMessage(r.restored, r.skipped));
      await load();
    });
  }
  function askBulkDelete() {
    const ids = [...selected];
    if (!canApply(ids)) return;
    if (needsDeleteConfirm(ids.length)) setPendingDelete(ids); else doBulk({ type: 'delete' });
  }

  async function copyDigest() {
    const text = digestText(digest, id => subs.find(x => x.id === id)?.name ?? 'Subscription', n => money(n));
    try { await navigator.clipboard.writeText(text); setNotice('Copied the 30-day summary.'); }
    catch { setTextModal({ title: 'Next 30 days summary', text }); }   // clipboard unavailable: show it selected so it can be copied by hand
  }

  async function remove(id: number) {
    const row = subs.find(x => x.id === id);
    if (!row) return;
    await db.subs.delete(id);
    await load();
    showToast(`Removed ${row.name}.`, 'Undo', 10000, async () => {
      await db.subs.put(row); // same id and every field, so it comes back exactly as it was
      setToast(null); setNotice(`Restored ${row.name}.`);
      await load();
    });
  }
  async function patchSub(id: number, patch: Partial<Subscription>) { await db.subs.update(id, patch); await load(); }
  async function setReminderDay(days: number, on: boolean) {
    const next = on ? [...new Set([...settings.reminderDays, days])].sort((x, y) => x - y) : settings.reminderDays.filter(d => d !== days);
    await saveSetting('reminderDays', next);
    await load();
  }
  async function dismissReminderBanner() { await saveSetting('reminderBannerDismissed', true); await load(); }

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
  const pwa = usePwa();
  async function installApp() { await promptInstall(); }
  function reloadForUpdate() {
    // never reload under an open form: ask first if a dialog (and so possibly unsaved input) is open
    if (modalDepth() > 0 && !confirm('You have a form open. Reload now and lose anything you have not saved?')) return;
    applyUpdate();
  }
  async function loadSample(ask = true) {
    if (ask && !confirm('Load sample data?\n\nThis adds 14 fake subscriptions (INR, USD, EUR) with sample exchange rates so you can try SubSweep. You can remove them again from the App card.')) return;
    try { const n = await loadSampleData(today()); setNotice(`Loaded ${n} sample subscriptions.`); } catch (e) { setError((e as Error).message); }
    await load();
  }
  async function removeSample() {
    // keep the removed rows and the sample settings so Undo can put everything back exactly
    const ids = settings.sampleIds;
    const rows = (await db.subs.bulkGet(ids)).filter((s): s is Subscription => !!s && s.importBatchId === SAMPLE_BATCH);
    const prior = { baseCurrency: settings.baseCurrency, rates: settings.rates };
    const n = await removeSampleData(ids);
    await load();
    showToast(`Removed ${n} sample subscription${n === 1 ? '' : 's'}.`, 'Undo', 15000, async () => {
      if (await db.subs.count() === 0) {
        await db.subs.bulkPut(rows);
        await db.settings.bulkPut([{ key: 'sampleIds', value: rows.map(r => r.id!) }, { key: 'baseCurrency', value: prior.baseCurrency }, { key: 'rates', value: prior.rates }]);
        setNotice(`Restored ${rows.length} sample subscriptions.`);
      } else setNotice('Could not undo: you have added subscriptions since.');
      setToast(null);
      await load();
    });
  }
  async function skipWelcome() { await saveSetting('onboardingDismissed', true); await load(); setNotice('Welcome skipped. You can bring it back from Settings.'); }
  async function showWelcomeAgain() {
    await saveSetting('onboardingDismissed', false); await load();
    setNotice(subs.length ? 'The welcome panel will show again when you have no subscriptions.' : 'Welcome panel shown.');
  }
  function exportSubsCsv() {
    const csv = subscriptionsToCsv(subs, settings);
    if (!hasDataRows(csv)) { setNotice('Nothing to export yet.'); return; }
    download(csvFileName('subscriptions', today()), csv, 'text/csv;charset=utf-8');
    setNotice('Exported your subscriptions as a CSV file.');
  }
  function exportDigestCsv() {
    const csv = digestToCsv(digest, subs, base);
    if (!hasDataRows(csv)) { setNotice('Nothing to export yet.'); return; }
    download(csvFileName('next30', today()), csv, 'text/csv;charset=utf-8');
    setNotice('Exported the next 30 days as a CSV file.');
  }
  function onTabKeys(e: React.KeyboardEvent) {
    const i = VIEWS.findIndex(([id]) => id === view);
    const n = nextTabIndex(e.key, i, VIEWS.length);
    if (n === null) return;
    e.preventDefault();
    setView(VIEWS[n][0]);
    document.getElementById(`tab-${VIEWS[n][0]}`)?.focus();
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
      setPendingBackup(await f.text()); // the preview dialog validates it and reports any problem itself
    } catch (e) { setError((e as Error).message); }
    if (backupRef.current) backupRef.current.value = '';
  }
  async function restore(mode: ImportMode, applySettings: boolean) {
    if (!pendingBackup) return;
    try {
      const { added, skipped, settingsWritten } = await importBackup(pendingBackup, mode, { applySettings });
      const sub = `${added} subscription${added === 1 ? '' : 's'}`;
      const extra = settingsWritten ? ` and ${settingsWritten} setting${settingsWritten === 1 ? '' : 's'}` : '';
      setNotice(mode === 'replace' ? `Restored ${sub}${extra} from backup.` : `Restored ${sub}${extra} from backup${skipped ? `, skipped ${skipped} already here` : ''}.`);
    } catch (e) { setError((e as Error).message); }
    setPendingBackup(null); load();
  }

  function download(name: string, content: string, type: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  async function askNotif() { if (typeof Notification !== 'undefined') setNotifState(await Notification.requestPermission()); }

  const cycleShort = (c: Cycle) => CYCLE_SHORT[c];

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      {toast && <Toast key={toast.id} message={toast.message} actionLabel={toast.actionLabel} durationMs={toast.durationMs} onAction={toast.onAction} onDismiss={() => setToast(null)} />}
      {pwa.updateReady && (
        <div className="banner update" role="status">
          <span>A new version of SubSweep is ready.</span>
          <button className="btn primary" onClick={reloadForUpdate}>Reload to update</button>
        </div>
      )}
      <header className="top">
        <h1>SUBSWEEP</h1>
        {!pwa.online && <span className="status-chip" role="status">Offline · your data stays on this device</span>}
        <nav className="actions" aria-label="Actions">
          <button className="btn primary" onClick={() => fileRef.current?.click()}>Scan statement ↗</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden tabIndex={-1} aria-label="Bank statement CSV file" onChange={e => onFile(e.target.files?.[0])} />
          <button className="btn add-top" onClick={() => setQuickAdd(true)}>+ Add <kbd className="kbd-hint" aria-hidden="true">N</kbd></button>
          <button className="btn" disabled={!subs.some(isLive)} onClick={() => download('subsweep-renewals.ics', buildIcs(subs), 'text/calendar')}>Calendar</button>
          {notifState === 'default' && <button className="btn" onClick={askNotif}>Reminders</button>}
        </nav>
      </header>

      <LiveRegion polite={notice} assertive={error} />
      <main id="main" tabIndex={-1}>
      {settings.sampleIds.length > 0 && (
        <div className="banner sample" role="note">
          <span>You're looking at fake sample data.</span>
          <button className="btn" onClick={removeSample}>Remove sample data</button>
        </div>
      )}
      {notifState === 'denied' && !settings.reminderBannerDismissed && (
        <div className="banner" role="note">
          <span>Browser notifications are blocked, so reminders show here in SubSweep only.</span>
          <button className="btn" onClick={dismissReminderBanner}>Got it</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {showWelcome && <Welcome onScan={() => fileRef.current?.click()} onAdd={() => setQuickAdd(true)} onSample={() => loadSample(false)} onSkip={skipWelcome} />}

      {promptReview && (
        <section className="card review-card" aria-label="Monthly review">
          <h2>Time for a monthly review</h2>
          <p className="muted">{dueReview.length} subscription{dueReview.length === 1 ? ' has' : 's have'} not been reviewed in the last 30 days. It takes about a minute.</p>
          <div className="row-actions start">
            <button className="btn primary" onClick={startReview}>Start review</button>
            <button className="btn" onClick={snoozeReviewPrompt}>Not now</button>
          </div>
        </section>
      )}

      {subs.length === 1 && (view === 'board' || view === 'list') && <EmptyState title="Insights need a few more subscriptions">Add at least 2 and SubSweep will point out overlaps, unused services, price rises and trials about to convert.</EmptyState>}
      <InsightCards insights={insights} money={n => money(n)} onDismiss={dismissInsight} onReview={reviewInsight} onUsed={i => markUsed(i.subIds[0])} />

      <div className="view-switch" role="tablist" aria-label="View" onKeyDown={onTabKeys}>
        {VIEWS.map(([id, label]) => (
          <button key={id} id={`tab-${id}`} role="tab" aria-selected={view === id} aria-controls="view-panel"
            tabIndex={view === id ? 0 : -1} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>

      <div role="tabpanel" id="view-panel" aria-labelledby={`tab-${view}`}>

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

      {view === 'digest' && (
        <DigestView digest={digest} subs={subs} money={money} onOpen={setDetail} onCopy={copyDigest} onPrint={() => window.print()} onCsv={exportDigestCsv} onSetRates={goToRates} />
      )}
      </div>

      {needRates.length > 0 && (view === 'board' || view === 'list') && (
        <section className="card warn" aria-label="Exchange rate needed">
          <h2>Exchange rate needed</h2>
          <p className="muted">{tot.missing.length} subscription{tot.missing.length === 1 ? ' is' : 's are'} left out of your totals because there is no rate for {needRates.join(', ')}.</p>
          <div className="row-actions"><button className="btn primary" onClick={goToRates}>Set rates</button></div>
        </section>
      )}
      {settings.ratesNeedReview && (
        <p className="notice">Base currency changed to {base}. Please review your exchange rates. <button className="link" onClick={goToRates}>Review rates</button></p>
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

      {(view === 'board' || view === 'list') && dueList.length > 0 && (
        <section aria-labelledby="renewing-soon-title">
          <h2 id="renewing-soon-title">{soonestLabel(dueList)}</h2>
          <div className="chips">
            {dueList.map(d => (
              <button key={d.key} className="chip" onClick={() => setDetail(d.sub)}>
                <BrandLogo name={d.sub.name} size={34} />
                <span><b>{d.sub.name}</b><small>{money(d.sub.amount, d.sub.currency)} · {whenText(d.daysLeft)}{d.trial && ' · trial ends'}</small></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(view === 'board' || view === 'list') && byCat.length > 0 && (
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

      {(view === 'board' || view === 'list') && methods.length > 0 && <PaymentBreakdown rows={methodRows} money={n => money(n)} onSetRates={goToRates} />}

      {(view === 'board' || view === 'list') && <section aria-labelledby="all-subs-title" className={selectMode ? 'select-pad' : undefined}>
        <div className="row sort-row">
          <h2 id="all-subs-title">All subscriptions</h2>
          {subs.length > 0 && (
            <div className="actions">
              {selectMode && <a className="btn" href="#bulk-bar" onClick={e => { e.preventDefault(); document.getElementById('bulk-bar')?.focus(); }}>Jump to actions</a>}
              <button id="select-toggle" className="btn" aria-pressed={selectMode} onClick={() => (selectMode ? exitSelectMode() : enterSelectMode())}>{selectMode ? 'Done selecting' : 'Select'}</button>
            </div>
          )}
        </div>
        {subs.length > 0 && (
          <div className="filter-row">
            <label className="sr-only" htmlFor="name-filter">Filter subscriptions</label>
            <input id="name-filter" ref={filterRef} type="search" className="filter" placeholder="Filter by name   ( / )" value={filter} autoComplete="off"
              onChange={e => setFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setFilter(''); e.currentTarget.blur(); } }} />
            {methods.length > 0 && (
              <label className="method-filter"><span className="sr-only">Payment method filter</span>
                <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)} aria-label="Filter by payment method">
                  <option value="all">All payment methods</option>
                  {methods.map(m => <option key={m.label} value={m.label}>{m.label} ({m.count})</option>)}
                  <option value="none">No payment method</option>
                </select></label>
            )}
            {(filter || methodFilter !== 'all') && <span className="muted" role="status">{visibleSubs.length} of {subs.length} shown</span>}
          </div>
        )}
        {subs.length === 0 && !showWelcome && <p className="empty">Nothing yet. Upload a statement CSV from your bank, or add a subscription by hand.</p>}
        {subs.length > 0 && visibleSubs.length === 0 && <EmptyState title="No subscriptions match" action={{ label: 'Clear filters', onClick: () => { setFilter(''); setMethodFilter('all'); } }}>Nothing matches the current filters.</EmptyState>}
        {visibleSubs.map(s => (
          <article className={`card sub${selectMode && selected.has(s.id!) ? ' selected' : ''}`} key={s.id}>
            <div className="row">
              <div className="with-logo">
                {selectMode && <input type="checkbox" className="sel" aria-label={`Select ${s.name}`} checked={selected.has(s.id!)} onChange={() => toggleOne(s.id!)} />}
                <BrandLogo name={s.name} size={48} />
                <div>
                  <h3>{s.name} {isSample(s) && <span className="pill sample-chip">Sample</span>}{s.isTrial && <span className="pill trial">trial</span>}{stateOf(s) !== 'active' && <span className={`pill st-${stateOf(s)}`}>{STATE_LABEL[stateOf(s)]}</span>}</h3>
                  <p className="muted">{s.category} · {CYCLE_LABEL[s.cycle].toLowerCase()} · next {s.nextRenewal} ({daysUntil(s.nextRenewal)}d)
                    {s.confidence !== undefined && <> · <span className={`conf conf-${confidenceLabel(s.confidence)}`} title={`Detected from a statement with ${Math.round(s.confidence * 100)}% confidence`}>{confidenceLabel(s.confidence)}</span></>}</p>
                  {s.priceCreep && <p className="creep">Price crept up: {money(s.priceCreep.from, s.currency)} → {money(s.priceCreep.to, s.currency)}</p>}
                  {s.paymentMethod && <p className="muted"><span className="pill pay-chip"><span className="sr-only">Payment method: </span>{s.paymentMethod}</span></p>}
                  {s.notes && <p className="note-text"><span aria-hidden="true">📝 </span><span className="sr-only">Note: </span>{s.notes}</p>}
                </div>
              </div>
              <div className="price">{money(s.amount, s.currency)}<small>/{cycleShort(s.cycle)}</small>
                <Converted s={s} base={base} rates={rates} money={money} onSetRate={goToRates} />
              </div>
            </div>
            {isLive(s) && <details><summary>How to cancel</summary><p className="muted">{cancelKit(s.name).steps}</p></details>}
            <div className="row-actions">
              {(s.priceHistory?.length ?? 0) >= 2 && <button className="link" onClick={() => setChartFor(s)}>Price history</button>}
              {isLive(s) && <ReminderMenu sub={s} now={today()} onChange={patch => patchSub(s.id!, patch)} />}
              {isLive(s) && <button className="link" onClick={() => markReviewed(s)} title={s.lastReviewedAt ? `Last reviewed ${s.lastReviewedAt}` : 'Never reviewed'}>Mark reviewed</button>}
              <button className="link" onClick={() => setDetail(s)}>{isLive(s) ? 'Cancel…' : 'Status'}</button>
              <button className="link" onClick={() => setEditing(s)}>Edit</button>
              <button className="link danger" onClick={() => remove(s.id!)}>Remove</button>
            </div>
          </article>
        ))}
        {selectMode && (
          <BulkBar
            count={selected.size} visible={visibleSubs.length}
            onCategory={category => doBulk({ type: 'category', category })}
            onUsed={() => doBulk({ type: 'used', date: today() })}
            onMute={() => doBulk({ type: 'mute' })}
            onCancel={() => doBulk({ type: 'cancel' })}
            onMethod={() => setMethodDialog(true)}
            onDelete={askBulkDelete}
            onSelectAll={() => setSelected(new Set(visibleSubs.map(x => x.id!)))}
            onClear={() => setSelected(new Set())}
          />
        )}
      </section>}

      {preview && (
        <ImportReview items={preview} skipped={scanInfo.skipped} tracked={scanInfo.tracked} money={money}
          onChange={setPreview} onAdd={addFromPreview} onCancel={() => setPreview(null)} />
      )}

      {detail && (
        <Modal onClose={() => setDetail(null)} title={detail.name}>
          <div className="detail-head">
            <BrandLogo name={detail.name} size={72} />
            <div>
              <div className="price">{money(detail.amount, detail.currency)}<small>/{cycleShort(detail.cycle)}</small></div>
              <p className="muted">{detail.category} · {CYCLE_LABEL[detail.cycle].toLowerCase()}{detail.isTrial && ' · free trial'}</p>
            </div>
          </div>
          <p>Next {detail.isTrial ? 'trial end' : 'renewal'}: <b>{detail.nextRenewal}</b> ({daysUntil(detail.nextRenewal)}d)</p>
          {(() => { const m = monthlyBase({ ...detail, isTrial: false }, base, rates);
            return m === null
              ? <p className="error">Set an exchange rate for {subCurrency(detail, base)} to see what this costs in {base}. <button className="link" onClick={() => { setDetail(null); goToRates(); }}>Set rate</button></p>
              : <p className="muted">That's about {money(m)} a month, {money(m * 12)} a year{detail.isTrial ? ' once the trial converts' : ''}.</p>; })()}
          {detail.lastUsedAt && <p className="muted">You last marked this used on {detail.lastUsedAt}.</p>}
          {detail.paymentMethod && <p className="muted">Paid with {detail.paymentMethod}.</p>}
          {detail.lastReviewedAt && <p className="muted">Last reviewed on {detail.lastReviewedAt}.</p>}
          {detail.notes && <p className="note-text"><b>Note:</b> {detail.notes}</p>}
          {(detail.priceHistory?.length ?? 0) > 1 && (
            <>
            <div className="row-actions start"><button className="btn" onClick={() => setChartFor(detail)}>Show price chart</button></div>
            <details className="history">
              <summary>Price history ({detail.priceHistory!.length} prices)</summary>
              <ol className="plain">{detail.priceHistory!.map(h => <li key={h.date + h.amount}><span className="muted">{h.date || 'earlier'}</span> · <b>{money(h.amount, detail.currency)}</b></li>)}</ol>
            </details>
            </>
          )}
          {isLive(detail) && <div className="row-actions start"><ReminderMenu sub={detail} now={today()} onChange={async patch => { await patchSub(detail.id!, patch); setDetail({ ...detail, ...patch }); }} /></div>}
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

      <ReminderSettings windows={settings.reminderDays} notifState={notifState} onToggle={setReminderDay} onAskPermission={askNotif} />

      <AppSettingsCard pwa={pwa} version={__APP_VERSION__} hasSubscriptions={subs.length > 0} sampleLoaded={settings.sampleIds.length > 0}
        onInstall={installApp} onLoadSample={() => loadSample()} onRemoveSample={removeSample} onShortcuts={() => setShowHelp(true)} onReview={startReview} onExportCsv={exportSubsCsv} onShowWelcome={showWelcomeAgain} />

      <section className="card">
        <h2>Backup</h2>
        <p className="muted">Save everything to a file you control, or restore it later. Nothing is uploaded.</p>
        <div className="actions">
          <button className="btn" onClick={downloadBackup}>Download backup</button>
          <button className="btn" onClick={() => backupRef.current?.click()}>Restore from backup</button>
          <input ref={backupRef} type="file" accept=".json,application/json" hidden tabIndex={-1} aria-label="Backup file to restore" onChange={e => onBackupFile(e.target.files?.[0])} />
        </div>
      </section>

      {pendingBackup !== null && <RestorePreview text={pendingBackup} onRestore={restore} onClose={() => setPendingBackup(null)} />}
      {methodDialog && <MethodDialog count={selected.size} labels={methods.map(m => m.label)} onClose={() => setMethodDialog(false)}
        onApply={label => { setMethodDialog(false); doBulk({ type: 'paymentMethod', label: canonicalLabel(label, subs) }); }} />}
      {quickAdd && <QuickAdd existing={subs} labels={methods.map(m => m.label)} base={base} today={today()} categoryFor={guessCategory} onAdd={save}
        onMore={d => { setQuickAdd(false); setEditing(d); }} onClose={() => setQuickAdd(false)} />}
      {showHelp && <ShortcutHelp onClose={() => setShowHelp(false)} />}
      {reviewQueue && <ReviewDialog queue={reviewQueue} money={money} onDecide={decideReview} onFinish={finishReview} />}

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.length} subscriptions?`}
          message={`This removes ${pendingDelete.length} subscriptions from SubSweep. You can undo it for a few seconds afterwards.`}
          confirmLabel={`Delete ${pendingDelete.length}`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { setPendingDelete(null); doBulk({ type: 'delete' }); }}
        />
      )}
      {chartFor && (
        <Modal title={`${chartFor.name}: price history`} onClose={() => setChartFor(null)}>
          <PriceChart history={chartFor.priceHistory} currency={chartFor.currency ?? base} name={chartFor.name} now={today()} />
        </Modal>
      )}
      {cancelFor && <CancelFlow sub={cancelFor} onSave={f => startCancel(cancelFor, f)} onClose={() => setCancelFor(null)} onText={(title, text) => setTextModal({ title, text })} />}
      {textModal && <TextModal title={textModal.title} text={textModal.text} onClose={() => setTextModal(null)} />}
      {editing && <EditForm sub={editing} base={base} labels={methods.map(m => m.label)} onSave={save} onCancel={() => setEditing(null)} />}
      </main>
      {!selectMode && <button className="fab" onClick={() => setQuickAdd(true)}>+ Add subscription</button>}
      <footer><button className="link" onClick={() => setShowHelp(true)}>Keyboard shortcuts</button> · Local-only · no accounts · no tracking · logos are bundled, never fetched. Always confirm cancellation steps on the provider's site.</footer>
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
      <div className="row-actions start">
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

function EditForm({ sub, base, labels, onSave, onCancel }: { sub: Subscription; base: string; labels: string[]; onSave: (s: Subscription) => Promise<string | null> | void; onCancel: () => void }) {
  const [s, setS] = useState(sub);
  const [problem, setProblem] = useState('');
  const set = <K extends keyof Subscription>(k: K, v: Subscription[K]) => setS(p => ({ ...p, [k]: v }));
  return (
    <Modal title={sub.id ? 'Edit subscription' : 'Add subscription'} onClose={onCancel}>
      <form onSubmit={async e => { e.preventDefault(); setProblem((await onSave({ ...s, currency: s.currency ?? base, category: s.category || guessCategory(s.name) })) ?? ''); }} className="form" noValidate>
        <label>Name<input required value={s.name} onChange={e => set('name', e.target.value)} /></label>
        <div className="two">
          <label>Amount<input required type="number" inputMode="decimal" min="0.01" step="0.01" value={s.amount || ''} onChange={e => set('amount', +e.target.value)} /></label>
          <label>Currency
            <select value={s.currency ?? base} onChange={e => set('currency', e.target.value)}>
              {[...new Set([s.currency ?? base, base, ...CURRENCIES.map(c => c.code)])].map(c => <option key={c}>{c}</option>)}
            </select></label>
        </div>
        <label>Billing cycle
          <select value={s.cycle} onChange={e => set('cycle', e.target.value as Cycle)}>
            {CYCLES.map(c => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
          </select></label>
        <label>Next renewal / trial end<input required type="date" value={s.nextRenewal} onChange={e => set('nextRenewal', e.target.value)} /></label>
        <label>Category
          <select value={s.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <PaymentField value={s.paymentMethod ?? ''} onChange={v => set('paymentMethod', v)} labels={labels} />
        <label className="check"><input type="checkbox" checked={s.isTrial} onChange={e => set('isTrial', e.target.checked)} /> This is a free trial (remind me before it converts)</label>
        <label>Notes (optional)
          <textarea className="textbox" rows={3} maxLength={NOTES_MAX} value={s.notes ?? ''} aria-describedby="notes-count" onChange={e => set('notes', e.target.value)} /></label>
        <p id="notes-count" className="muted notes-count"><small>{(s.notes ?? '').length} / {NOTES_MAX}</small></p>
        {problem && <p className="error" role="alert">{problem}</p>}
        <div className="row-actions"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn primary">Save</button></div>
      </form>
    </Modal>
  );
}
