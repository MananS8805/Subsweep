import { db } from './db';
import { CYCLES, type CancelStatus, type Cycle, type DismissedDuplicate, type Subscription } from './types';
import { isCurrencyCode } from './currency';
import { cleanSettings, isKnownSetting, sameSetting, type SettingKey } from './settingsSchema';
import { NOTES_MAX } from './validate';

export const BACKUP_APP = 'subsweep';
export const BACKUP_VERSION = 2; // v2 adds the cancel & verify fields; v1 files still restore. Later fields are optional, so the version stays 2.
export type ImportMode = 'merge' | 'replace';

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  subscriptions: Subscription[];
  dismissedDuplicates: string[];
  settings: Record<string, unknown>;
}

export class BackupError extends Error {}

export async function exportBackup(): Promise<Backup> {
  const [subscriptions, dismissed, settings] = await Promise.all([
    db.subs.orderBy('id').toArray(), db.dismissedDuplicates.toArray(), db.settings.toArray(),
  ]);
  return {
    app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    subscriptions,
    dismissedDuplicates: dismissed.map(d => d.key),
    // every setting SubSweep stores (base currency, rates, reminder days, dismissed insights, review snooze...), nothing else
    settings: Object.fromEntries(settings.filter(r => isKnownSetting(r.key)).map(r => [r.key, r.value])),
  };
}

export const backupFileName = (d = new Date()) => `subsweep-backup-${d.toISOString().slice(0, 10)}.json`;

// ---- validation ------------------------------------------------------------

const STATUSES: CancelStatus[] = ['active', 'cancelling', 'cancelled'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIsoDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const isTimestamp = (v: unknown): v is string => typeof v === 'string' && !isNaN(Date.parse(v));

function cleanSub(raw: unknown, i: number): Subscription {
  const where = `subscription #${i + 1}`;
  if (!isObj(raw)) throw new BackupError(`Invalid backup: ${where} is not an object.`);
  const bad = (field: string) => new BackupError(`Invalid backup: ${where} has an invalid "${field}".`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) throw bad('name');
  if (!isNum(raw.amount) || raw.amount < 0) throw bad('amount');
  if (!CYCLES.includes(raw.cycle as Cycle)) throw bad('cycle');
  if (!isIsoDay(raw.nextRenewal)) throw bad('nextRenewal');
  if (typeof raw.category !== 'string') throw bad('category');
  if (typeof raw.isTrial !== 'boolean') throw bad('isTrial');
  const sub: Subscription = {
    name: raw.name, amount: raw.amount, cycle: raw.cycle as Cycle, nextRenewal: raw.nextRenewal,
    category: raw.category, isTrial: raw.isTrial,
  };
  if (raw.id !== undefined) {
    if (!Number.isInteger(raw.id) || (raw.id as number) < 1) throw bad('id');
    sub.id = raw.id as number;
  }
  if (raw.priceCreep != null) {
    if (!isObj(raw.priceCreep) || !isNum(raw.priceCreep.from) || !isNum(raw.priceCreep.to)) throw bad('priceCreep');
    sub.priceCreep = { from: raw.priceCreep.from, to: raw.priceCreep.to };
  } else if (raw.priceCreep === null) sub.priceCreep = null;
  if (raw.notes !== undefined) {
    if (typeof raw.notes !== 'string') throw bad('notes');
    if (raw.notes.trim()) sub.notes = raw.notes.trim().slice(0, NOTES_MAX); // plain text, at most 500 characters
  }
  if (raw.lastReviewedAt !== undefined) {
    if (!isIsoDay(raw.lastReviewedAt)) throw bad('lastReviewedAt');
    sub.lastReviewedAt = raw.lastReviewedAt;
  }
  if (raw.createdAt !== undefined) {
    if (!isTimestamp(raw.createdAt)) throw bad('createdAt');
    sub.createdAt = raw.createdAt;
  }
  if (raw.priceHistory !== undefined) {
    if (!Array.isArray(raw.priceHistory)) throw bad('priceHistory');
    sub.priceHistory = raw.priceHistory.map(h => {
      if (!isObj(h) || typeof h.date !== 'string' || !isNum(h.amount)) throw bad('priceHistory');
      return { date: h.date, amount: h.amount };
    });
  }
  if (raw.status !== undefined) {
    if (!STATUSES.includes(raw.status as CancelStatus)) throw bad('status');
    sub.status = raw.status as CancelStatus;
  }
  for (const f of ['cancelRequestedAt', 'cancelEffectiveDate', 'verifiedAt'] as const) {
    if (raw[f] !== undefined) {
      if (!isIsoDay(raw[f])) throw bad(f);
      sub[f] = raw[f] as string;
    }
  }
  if (raw.currency !== undefined) {
    if (!isCurrencyCode(raw.currency)) throw bad('currency');
    sub.currency = raw.currency;
  }
  if (raw.selectedForCancel !== undefined) {
    if (typeof raw.selectedForCancel !== 'boolean') throw bad('selectedForCancel');
    sub.selectedForCancel = raw.selectedForCancel;
  }
  if (raw.lastUsedAt !== undefined) {
    if (!isIsoDay(raw.lastUsedAt)) throw bad('lastUsedAt');
    sub.lastUsedAt = raw.lastUsedAt;
  }
  if (raw.confidence !== undefined) {
    if (!isNum(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) throw bad('confidence');
    sub.confidence = raw.confidence;
  }
  if (raw.importBatchId !== undefined) {
    if (typeof raw.importBatchId !== 'string') throw bad('importBatchId');
    sub.importBatchId = raw.importBatchId;
  }
  if (raw.muted !== undefined) {
    if (typeof raw.muted !== 'boolean') throw bad('muted');
    sub.muted = raw.muted;
  }
  if (raw.snoozedUntil !== undefined) {
    if (!isIsoDay(raw.snoozedUntil)) throw bad('snoozedUntil');
    sub.snoozedUntil = raw.snoozedUntil;
  }
  if (raw.cancelRef !== undefined) {
    if (typeof raw.cancelRef !== 'string') throw bad('cancelRef');
    sub.cancelRef = raw.cancelRef;
  }
  if (raw.zombieCharges !== undefined) {
    if (!Array.isArray(raw.zombieCharges)) throw bad('zombieCharges');
    sub.zombieCharges = raw.zombieCharges.map(c => {
      if (!isObj(c) || !isIsoDay(c.date) || !isNum(c.amount)) throw bad('zombieCharges');
      return { date: c.date, amount: c.amount };
    });
  }
  return sub; // unknown extra fields are dropped
}

export interface BackupFile {
  backup: Backup;
  warnings: string[];     // things left out because they were malformed (never applied)
  hasSettings: boolean;   // whether the file has any recognised settings at all
}

/** Parse and fully validate backup JSON. Throws BackupError with a readable message; never touches the DB. */
export function readBackup(text: string): BackupFile {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new BackupError('This file is not valid JSON, so it cannot be a SubSweep backup.'); }
  if (!isObj(json) || json.app !== BACKUP_APP) throw new BackupError('This is not a SubSweep backup file.');
  if (!Number.isInteger(json.version) || (json.version as number) < 1) throw new BackupError('Invalid backup: missing or bad version number.');
  if ((json.version as number) > BACKUP_VERSION) {
    throw new BackupError(`This backup was made by a newer version of SubSweep (backup format v${json.version}). Update the app to restore it.`);
  }
  if (!Array.isArray(json.subscriptions)) throw new BackupError('Invalid backup: "subscriptions" must be a list.');
  const subscriptions = json.subscriptions.map(cleanSub);
  const ids = subscriptions.map(s => s.id).filter((id): id is number => id !== undefined);
  if (new Set(ids).size !== ids.length) throw new BackupError('Invalid backup: two subscriptions share the same id.');

  const rawDismissed = json.dismissedDuplicates ?? [];
  if (!Array.isArray(rawDismissed) || !rawDismissed.every(k => typeof k === 'string' && /^\d+-\d+$/.test(k))) {
    throw new BackupError('Invalid backup: "dismissedDuplicates" must be a list of pair keys.');
  }
  const cleaned = cleanSettings(json.settings);
  const warnings = [...cleaned.warnings];
  if (cleaned.ignored.length) warnings.push(`Ignored ${cleaned.ignored.length} setting${cleaned.ignored.length === 1 ? '' : 's'} this version does not know: ${cleaned.ignored.join(', ')}.`);
  return {
    backup: {
      app: BACKUP_APP, version: json.version as number,
      exportedAt: isTimestamp(json.exportedAt) ? json.exportedAt : new Date(0).toISOString(),
      subscriptions, dismissedDuplicates: [...new Set(rawDismissed as string[])], settings: { ...cleaned.values },
    },
    warnings,
    hasSettings: Object.keys(cleaned.values).length > 0,
  };
}

/** Parse and validate; the settings it returns are only the well-formed, known ones. */
export const parseBackup = (text: string): Backup => readBackup(text).backup;

const textOf = async (file: Blob | string) => (typeof file === 'string' ? file : file.text());

// ---- what a restore would do -----------------------------------------------

export interface SettingChange { key: SettingKey; from: unknown; to: unknown }

export interface RestorePreview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  mode: ImportMode;
  applySettings: boolean;            // the effective choice (Merge: off unless ticked; Replace: on unless unticked)
  hasSettings: boolean;
  counts: { toAdd: number; toSkip: number; toReplace: number; subscriptionsInFile: number; existing: number };
  settingsChanges: SettingChange[];  // settings that WILL be written because they differ
  settingsKept: SettingChange[];     // settings in the file that differ but will be left as they are
}

export interface RestoreOptions { applySettings?: boolean }
/** Merge never overwrites settings you already have unless asked; Replace brings the file's settings along unless declined. */
export const defaultApplySettings = (mode: ImportMode) => mode === 'replace';

/**
 * Which settings a restore writes. With `apply` on, every setting in the file overwrites yours. With it off (the Merge
 * default) only settings that are not set yet are filled in, and anything you already have stays as it is. Settings the
 * file does not mention are never touched, so an old backup with no settings leaves yours exactly as they are.
 */
export function planSettings(current: Map<string, unknown>, fileValues: Partial<Record<SettingKey, unknown>>, apply: boolean) {
  const writes: SettingChange[] = [], kept: SettingChange[] = [];
  for (const [k, to] of Object.entries(fileValues) as [SettingKey, unknown][]) {
    const has = current.has(k), from = current.get(k);
    if (has && sameSetting(from, to)) continue;
    if (apply || !has) writes.push({ key: k, from, to }); else kept.push({ key: k, from, to });
  }
  return { writes, kept };
}

/**
 * Read a file and report exactly what restoring it would do, without writing anything. A malformed or wrong-app file comes
 * back with `valid: false` and readable errors. This only ever reads the database.
 */
export async function previewBackup(file: Blob | string, mode: ImportMode, options: RestoreOptions = {}): Promise<RestorePreview> {
  const applySettings = options.applySettings ?? defaultApplySettings(mode);
  const [existingIds, settingRows] = await Promise.all([db.subs.toCollection().primaryKeys(), db.settings.toArray()]);
  const base: RestorePreview = {
    valid: false, errors: [], warnings: [], mode, applySettings, hasSettings: false,
    counts: { toAdd: 0, toSkip: 0, toReplace: 0, subscriptionsInFile: 0, existing: existingIds.length },
    settingsChanges: [], settingsKept: [],
  };
  let parsed: BackupFile;
  try { parsed = readBackup(await textOf(file)); }
  catch (e) { return { ...base, errors: [e instanceof Error ? e.message : 'This file could not be read.'] }; }

  const { backup, warnings, hasSettings } = parsed;
  const have = new Set(existingIds);
  const clash = backup.subscriptions.filter(s => s.id !== undefined && have.has(s.id)).length;
  const counts = mode === 'replace'
    ? { toAdd: backup.subscriptions.length, toSkip: 0, toReplace: existingIds.length }
    : { toAdd: backup.subscriptions.length - clash, toSkip: clash, toReplace: 0 };
  const plan = planSettings(new Map(settingRows.map(r => [r.key, r.value])), backup.settings as Partial<Record<SettingKey, unknown>>, applySettings);
  return {
    ...base, valid: true, warnings, hasSettings,
    counts: { ...counts, subscriptionsInFile: backup.subscriptions.length, existing: existingIds.length },
    settingsChanges: plan.writes, settingsKept: plan.kept,
  };
}

// ---- import ----------------------------------------------------------------

export interface ImportResult { added: number; skipped: number; settingsWritten: number; warnings: string[] }

/**
 * Restore from a backup file or its text. Everything is validated before the first write, and the write is a single
 * transaction, so a bad file or a failure leaves existing data untouched.
 * merge: add what is missing, skip ids that already exist. replace: remove your subscriptions first, then load the file.
 * Settings follow `options.applySettings` (see planSettings); they are never cleared.
 */
export async function importBackup(file: Blob | string, mode: ImportMode, options: RestoreOptions = {}): Promise<ImportResult> {
  const { backup, warnings } = readBackup(await textOf(file));
  const apply = options.applySettings ?? defaultApplySettings(mode);
  return db.transaction('rw', db.subs, db.dismissedDuplicates, db.settings, async () => {
    if (mode === 'replace') await Promise.all([db.subs.clear(), db.dismissedDuplicates.clear()]);
    const existingIds = new Set(await db.subs.toCollection().primaryKeys());
    const toAdd = backup.subscriptions.filter(s => s.id === undefined || !existingIds.has(s.id));
    await db.subs.bulkAdd(toAdd);

    const existingKeys = new Set((await db.dismissedDuplicates.toArray()).map(d => d.key));
    const newDismissed: DismissedDuplicate[] = backup.dismissedDuplicates.filter(k => !existingKeys.has(k)).map(key => ({ key }));
    await db.dismissedDuplicates.bulkAdd(newDismissed);

    const current = new Map((await db.settings.toArray()).map(r => [r.key, r.value]));
    const { writes } = planSettings(current, backup.settings as Partial<Record<SettingKey, unknown>>, apply);
    await db.settings.bulkPut(writes.map(w => ({ key: w.key, value: w.to })));
    return { added: toAdd.length, skipped: backup.subscriptions.length - toAdd.length, settingsWritten: writes.length, warnings };
  });
}
