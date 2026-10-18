import type { Subscription } from './types';

/** What a bulk action does to the selected subscriptions. */
export type BulkAction =
  | { type: 'category'; category: string }
  | { type: 'used'; date: string }      // "Mark used recently"
  | { type: 'mute' }                    // mute reminders
  | { type: 'cancel' }                  // tick "Cancel?" for the savings simulator
  | { type: 'delete' };

type Field = keyof Subscription;

export const BULK_LABEL: Record<BulkAction['type'], string> = {
  category: 'Changed category', used: 'Marked used recently', mute: 'Muted reminders', cancel: 'Marked Cancel?', delete: 'Deleted',
};

/** The subscription fields an action writes (and so the only ones undo has to put back). */
export function touchedFields(a: BulkAction): Field[] {
  switch (a.type) {
    case 'category': return ['category'];
    case 'used': return ['lastUsedAt'];
    case 'mute': return ['muted'];
    case 'cancel': return ['selectedForCancel'];
    case 'delete': return [];
  }
}

/** The values an action writes, or null for delete. */
export function patchFor(a: BulkAction): Partial<Subscription> | null {
  switch (a.type) {
    case 'category': return { category: a.category };
    case 'used': return { lastUsedAt: a.date };
    case 'mute': return { muted: true };
    case 'cancel': return { selectedForCancel: true };
    case 'delete': return null;
  }
}

/** Actions need at least one selected item. */
export const canApply = (ids: Iterable<number>): boolean => [...ids].length > 0;

/** One changed row: what each touched field held before (`absent` lists fields the row did not have at all) and what we set. */
export interface UndoEntry {
  id: number;
  before: Partial<Record<Field, unknown>>;
  absent: Field[];
  after: Partial<Record<Field, unknown>>;
}

export interface UndoRecord {
  kind: BulkAction['type'];
  fields: Field[];
  entries: UndoEntry[];      // update actions
  deleted: Subscription[];   // delete: the full rows
}

export interface BulkPlan {
  patches: { id: number; patch: Partial<Subscription> }[];
  deleteIds: number[];
  undo: UndoRecord;
  changed: number;
}

const same = (a: unknown, b: unknown) => Object.is(a, b);

/**
 * Work out what a bulk action changes without touching anything. Ids that do not exist are ignored, an id listed twice
 * counts once (so "before" is always the real previous value, never one we wrote ourselves), and rows the action would not
 * change (already muted, already in that category) are left out so counts and undo only cover real changes.
 */
export function applyBulk(subs: Subscription[], ids: Iterable<number>, action: BulkAction): BulkPlan {
  const byId = new Map(subs.filter(s => s.id !== undefined).map(s => [s.id!, s]));
  const wanted = [...new Set(ids)].filter(id => byId.has(id));
  const fields = touchedFields(action);
  const undo: UndoRecord = { kind: action.type, fields, entries: [], deleted: [] };
  const patch = patchFor(action);

  if (action.type === 'delete') {
    undo.deleted = wanted.map(id => structuredClone(byId.get(id)!));
    return { patches: [], deleteIds: wanted, undo, changed: wanted.length };
  }

  const patches: BulkPlan['patches'] = [];
  for (const id of wanted) {
    const row = byId.get(id)!;
    const after = patch as Record<string, unknown>;
    if (fields.every(f => same((row as unknown as Record<string, unknown>)[f], after[f]))) continue; // nothing would change
    const before: UndoEntry['before'] = {}, absent: Field[] = [];
    for (const f of fields) { if (f in row) before[f] = structuredClone((row as unknown as Record<string, unknown>)[f]); else absent.push(f); }
    undo.entries.push({ id, before, absent, after: Object.fromEntries(fields.map(f => [f, after[f]])) });
    patches.push({ id, patch: patch! });
  }
  return { patches, deleteIds: [], undo, changed: patches.length };
}

export interface UndoPlan {
  restores: { id: number; patch: Partial<Subscription> }[];  // fields to put back (undefined removes the field)
  reinserts: Subscription[];                                   // deleted rows to bring back whole
  restored: number;
  skipped: number;                                             // edited, deleted or replaced by something else since
}

/**
 * Decide what undo can safely do given the rows as they are NOW (`current`). Exact previous values are put back. An item
 * that was edited by something else since (its touched fields no longer hold what we wrote), or was deleted, is skipped
 * rather than overwritten, and so is a deleted row whose id has been taken again.
 */
export function planUndo(current: Iterable<Subscription>, undo: UndoRecord): UndoPlan {
  const byId = new Map([...current].filter(s => s.id !== undefined).map(s => [s.id!, s]));
  const plan: UndoPlan = { restores: [], reinserts: [], restored: 0, skipped: 0 };

  for (const e of undo.entries) {
    const row = byId.get(e.id) as unknown as Record<string, unknown> | undefined;
    if (!row || undo.fields.some(f => !same(row[f], e.after[f]))) { plan.skipped++; continue; }
    const patch: Record<string, unknown> = {};
    for (const f of undo.fields) patch[f] = e.absent.includes(f) ? undefined : e.before[f];
    plan.restores.push({ id: e.id, patch: patch as Partial<Subscription> });
    plan.restored++;
  }
  for (const row of undo.deleted) {
    if (row.id === undefined || byId.has(row.id)) { plan.skipped++; continue; }
    plan.reinserts.push(structuredClone(row));
    plan.restored++;
  }
  return plan;
}

/** "Restored 3" / "Restored 2. 1 item could not be restored." for the live region and toast. */
export function undoMessage(restored: number, skipped: number): string {
  const r = `Restored ${restored} item${restored === 1 ? '' : 's'}.`;
  return skipped ? `${r} ${skipped} item${skipped === 1 ? '' : 's'} could not be restored.` : r;
}

/** "Deleted 3 subscriptions." / "Changed category for 3 subscriptions." */
export function doneMessage(action: BulkAction, changed: number): string {
  const what = `${changed} subscription${changed === 1 ? '' : 's'}`;
  return action.type === 'category' ? `Changed category to ${action.category} for ${what}.`
    : action.type === 'delete' ? `Deleted ${what}.`
      : action.type === 'used' ? `Marked ${what} as used recently.`
        : action.type === 'mute' ? `Muted reminders for ${what}.`
          : `Marked ${what} Cancel?.`;
}

/** Deleting more than this many at once asks for confirmation first. */
export const CONFIRM_DELETE_OVER = 3;
export const needsDeleteConfirm = (count: number) => count > CONFIRM_DELETE_OVER;
