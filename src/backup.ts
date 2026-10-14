import { db } from './db';
import type { CancelStatus, Cycle, DismissedDuplicate, Subscription } from './types';
import { isCurrencyCode } from './currency';

export const BACKUP_APP = 'subsweep';
export const BACKUP_VERSION = 2; // v2 adds the cancel & verify fields; v1 files still restore
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
    settings: Object.fromEntries(settings.map(s => [s.key, s.value])),
  };
}

export const backupFileName = (d = new Date()) => `subsweep-backup-${d.toISOString().slice(0, 10)}.json`;

// ---- validation ------------------------------------------------------------

const CYCLES: Cycle[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
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
    sub.notes = raw.notes;
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

/** Parse and fully validate backup JSON. Throws BackupError with a readable message; never touches the DB. */
export function parseBackup(text: string): Backup {
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
  const rawSettings = json.settings ?? {};
  if (!isObj(rawSettings)) throw new BackupError('Invalid backup: "settings" must be an object.');
  return {
    app: BACKUP_APP, version: json.version as number,
    exportedAt: isTimestamp(json.exportedAt) ? json.exportedAt : new Date(0).toISOString(),
    subscriptions, dismissedDuplicates: [...new Set(rawDismissed as string[])], settings: { ...rawSettings },
  };
}

// ---- import ----------------------------------------------------------------

export interface ImportResult { added: number; skipped: number }

/**
 * Restore from a backup file or its text. Everything is validated before the first write,
 * and the write is a single transaction, so a bad file or a failure leaves existing data untouched.
 * merge: add what is missing, skip ids that already exist. replace: wipe, then load the backup.
 */
export async function importBackup(file: Blob | string, mode: ImportMode): Promise<ImportResult> {
  const backup = parseBackup(typeof file === 'string' ? file : await file.text());
  return db.transaction('rw', db.subs, db.dismissedDuplicates, db.settings, async () => {
    if (mode === 'replace') {
      await Promise.all([db.subs.clear(), db.dismissedDuplicates.clear(), db.settings.clear()]);
    }
    const existingIds = new Set(await db.subs.toCollection().primaryKeys());
    const toAdd = backup.subscriptions.filter(s => s.id === undefined || !existingIds.has(s.id));
    await db.subs.bulkAdd(toAdd);

    const existingKeys = new Set((await db.dismissedDuplicates.toArray()).map(d => d.key));
    const newDismissed: DismissedDuplicate[] = backup.dismissedDuplicates.filter(k => !existingKeys.has(k)).map(key => ({ key }));
    await db.dismissedDuplicates.bulkAdd(newDismissed);

    const existingSettings = new Set(await db.settings.toCollection().primaryKeys());
    await db.settings.bulkAdd(Object.entries(backup.settings).filter(([k]) => !existingSettings.has(k)).map(([key, value]) => ({ key, value })));
    return { added: toAdd.length, skipped: backup.subscriptions.length - toAdd.length };
  });
}
