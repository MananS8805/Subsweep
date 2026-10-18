import { db } from './db';
import { applyBulk, planUndo, type BulkAction, type BulkPlan, type UndoRecord } from './bulk';
import type { Subscription } from './types';

/** Apply a bulk action in one transaction and return what changed plus the record needed to undo it. */
export async function runBulk(subs: Subscription[], ids: Iterable<number>, action: BulkAction): Promise<BulkPlan> {
  const plan = applyBulk(subs, ids, action);
  await db.transaction('rw', db.subs, async () => {
    for (const { id, patch } of plan.patches) await db.subs.update(id, patch);
    if (plan.deleteIds.length) await db.subs.bulkDelete(plan.deleteIds);
  });
  return plan;
}

/** Undo one bulk action against the rows as they are now. Anything edited or deleted since is skipped and counted. */
export async function runUndo(undo: UndoRecord): Promise<{ restored: number; skipped: number }> {
  return db.transaction('rw', db.subs, async () => {
    const ids = [...undo.entries.map(e => e.id), ...undo.deleted.map(r => r.id!).filter(id => id !== undefined)];
    const current = (await db.subs.bulkGet(ids)).filter((s): s is Subscription => !!s);
    const plan = planUndo(current, undo);
    for (const { id, patch } of plan.restores) await db.subs.update(id, patch);
    if (plan.reinserts.length) await db.subs.bulkAdd(plan.reinserts);
    return { restored: plan.restored, skipped: plan.skipped };
  });
}
