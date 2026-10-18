import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyBulk, planUndo, canApply, patchFor, touchedFields, undoMessage, doneMessage, needsDeleteConfirm, type BulkAction } from './bulk';
import { runBulk, runUndo } from './bulkDb';
import { db } from './db';
import type { Subscription } from './types';

const row = (id: number, o: Partial<Subscription> = {}): Subscription => ({
  id, name: `Sub ${id}`, amount: 10 * id, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false, ...o,
});
const rows = () => [row(1), row(2, { category: 'Music' }), row(3, { muted: true }), row(4, { lastUsedAt: '2026-09-01' }), row(5, { selectedForCancel: true })];

describe('what each action does', () => {
  it('writes the right fields', () => {
    expect(patchFor({ type: 'category', category: 'Gaming' })).toEqual({ category: 'Gaming' });
    expect(patchFor({ type: 'used', date: '2026-10-19' })).toEqual({ lastUsedAt: '2026-10-19' });
    expect(patchFor({ type: 'mute' })).toEqual({ muted: true });
    expect(patchFor({ type: 'cancel' })).toEqual({ selectedForCancel: true });
    expect(patchFor({ type: 'delete' })).toBeNull();
    expect(touchedFields({ type: 'delete' })).toEqual([]);
  });
  it('actions need at least one selected item', () => {
    expect(canApply([])).toBe(false);
    expect(canApply(new Set<number>())).toBe(false);
    expect(canApply([1])).toBe(true);
  });
  it('a plan for an empty selection changes nothing', () => {
    const p = applyBulk(rows(), [], { type: 'mute' });
    expect(p).toMatchObject({ patches: [], deleteIds: [], changed: 0 });
  });
});

describe('applyBulk', () => {
  it('category: patches every selected row and records the previous category', () => {
    const p = applyBulk(rows(), [1, 2], { type: 'category', category: 'Gaming' });
    expect(p.changed).toBe(2);
    expect(p.patches.map(x => x.id)).toEqual([1, 2]);
    expect(p.undo.entries.map(e => [e.id, e.before.category, e.after.category])).toEqual([[1, 'Other', 'Gaming'], [2, 'Music', 'Gaming']]);
  });
  it('mute: skips rows that are already muted, and remembers which rows had no muted field at all', () => {
    const p = applyBulk(rows(), [1, 3], { type: 'mute' });
    expect(p.patches.map(x => x.id)).toEqual([1]);
    expect(p.undo.entries[0].absent).toEqual(['muted']);
  });
  it('used and cancel: only rows that would change are touched', () => {
    expect(applyBulk(rows(), [4], { type: 'used', date: '2026-09-01' }).changed).toBe(0);
    expect(applyBulk(rows(), [4], { type: 'used', date: '2026-10-19' }).undo.entries[0].before).toEqual({ lastUsedAt: '2026-09-01' });
    expect(applyBulk(rows(), [5], { type: 'cancel' }).changed).toBe(0);
    expect(applyBulk(rows(), [1, 5], { type: 'cancel' }).patches.map(x => x.id)).toEqual([1]);
  });
  it('delete: captures full copies of the rows', () => {
    const subs = rows();
    const p = applyBulk(subs, [2, 3], { type: 'delete' });
    expect(p.deleteIds).toEqual([2, 3]);
    expect(p.undo.deleted).toEqual([subs[1], subs[2]]);
    expect(p.undo.deleted[0]).not.toBe(subs[1]); // a copy, so later edits cannot change it
  });
  it('ignores unknown ids and counts an id listed twice once', () => {
    const p = applyBulk(rows(), [1, 1, 99], { type: 'category', category: 'Gaming' });
    expect(p.changed).toBe(1);
    expect(p.undo.entries[0].before.category).toBe('Other'); // the real previous value, not one we wrote
  });
});

describe('planUndo', () => {
  const apply = (subs: Subscription[], p: ReturnType<typeof applyBulk>) => subs.map(s => { const x = p.patches.find(q => q.id === s.id); return x ? { ...s, ...x.patch } : s; });

  it('puts back the exact previous category', () => {
    const before = rows(), p = applyBulk(before, [1, 2], { type: 'category', category: 'Gaming' });
    const plan = planUndo(apply(before, p), p.undo);
    expect(plan).toMatchObject({ restored: 2, skipped: 0 });
    expect(plan.restores).toEqual([{ id: 1, patch: { category: 'Other' } }, { id: 2, patch: { category: 'Music' } }]);
  });
  it('removes flags that did not exist before (mute, cancel) instead of setting them to false', () => {
    const before = rows(), p = applyBulk(before, [1], { type: 'mute' });
    expect(planUndo(apply(before, p), p.undo).restores).toEqual([{ id: 1, patch: { muted: undefined } }]);
    const c = applyBulk(before, [1], { type: 'cancel' });
    expect(planUndo(apply(before, c), c.undo).restores[0].patch).toEqual({ selectedForCancel: undefined });
  });
  it('restores a previous "used" date', () => {
    const before = rows(), p = applyBulk(before, [4], { type: 'used', date: '2026-10-19' });
    expect(planUndo(apply(before, p), p.undo).restores).toEqual([{ id: 4, patch: { lastUsedAt: '2026-09-01' } }]);
  });
  it('delete: reinserts the full rows', () => {
    const before = rows(), p = applyBulk(before, [2, 3], { type: 'delete' });
    const now = before.filter(s => ![2, 3].includes(s.id!));
    const plan = planUndo(now, p.undo);
    expect(plan.reinserts).toEqual([before[1], before[2]]);
    expect(plan).toMatchObject({ restored: 2, skipped: 0 });
  });
  it('skips an item that was deleted since', () => {
    const before = rows(), p = applyBulk(before, [1, 2], { type: 'mute' });
    const now = apply(before, p).filter(s => s.id !== 2);
    expect(planUndo(now, p.undo)).toMatchObject({ restored: 1, skipped: 1 });
  });
  it('skips an item that was edited by something else since', () => {
    const before = rows(), p = applyBulk(before, [1, 2], { type: 'category', category: 'Gaming' });
    const now = apply(before, p).map(s => (s.id === 2 ? { ...s, category: 'Software' } : s)); // changed again elsewhere
    const plan = planUndo(now, p.undo);
    expect(plan).toMatchObject({ restored: 1, skipped: 1 });
    expect(plan.restores.map(r => r.id)).toEqual([1]);
  });
  it('does not reinsert a deleted row whose id has been taken again', () => {
    const before = rows(), p = applyBulk(before, [2], { type: 'delete' });
    const now = [...before.filter(s => s.id !== 2), row(2, { name: 'Different' })];
    expect(planUndo(now, p.undo)).toMatchObject({ reinserts: [], restored: 0, skipped: 1 });
  });
  it('touching the same item twice: undoing the second action returns to the state after the first', () => {
    const s0 = rows();
    const a = applyBulk(s0, [1], { type: 'category', category: 'Gaming' });
    const s1 = apply(s0, a);
    const b = applyBulk(s1, [1], { type: 'category', category: 'Software' });
    const s2 = apply(s1, b);
    expect(planUndo(s2, b.undo).restores).toEqual([{ id: 1, patch: { category: 'Gaming' } }]);
    // the older undo is no longer safe (the row changed again) and is skipped, not forced
    expect(planUndo(s2, a.undo)).toMatchObject({ restored: 0, skipped: 1 });
  });
});

describe('messages', () => {
  it('words the results', () => {
    expect(undoMessage(3, 0)).toBe('Restored 3 items.');
    expect(undoMessage(1, 0)).toBe('Restored 1 item.');
    expect(undoMessage(2, 1)).toBe('Restored 2 items. 1 item could not be restored.');
    expect(undoMessage(0, 4)).toBe('Restored 0 items. 4 items could not be restored.');
    expect(doneMessage({ type: 'delete' }, 1)).toBe('Deleted 1 subscription.');
    expect(doneMessage({ type: 'category', category: 'Music' }, 3)).toBe('Changed category to Music for 3 subscriptions.');
  });
  it('asks for confirmation only when deleting more than 3', () => {
    expect([0, 1, 3].some(needsDeleteConfirm)).toBe(false);
    expect([4, 5, 40].every(needsDeleteConfirm)).toBe(true);
  });
});

describe('against the real database', () => {
  beforeEach(async () => { await db.subs.clear(); await db.subs.bulkAdd(rows()); });
  const all = () => db.subs.orderBy('id').toArray();
  const run = async (ids: number[], action: BulkAction) => runBulk(await all(), ids, action);

  it('applies a bulk category change and undoes it exactly', async () => {
    const before = await all();
    const p = await run([1, 2, 3], { type: 'category', category: 'Gaming' });
    expect((await all()).slice(0, 3).map(s => s.category)).toEqual(['Gaming', 'Gaming', 'Gaming']);
    expect(await runUndo(p.undo)).toEqual({ restored: 3, skipped: 0 });
    expect(await all()).toEqual(before);
  });
  it('mute then undo removes the field entirely (the row is byte-for-byte what it was)', async () => {
    const before = await all();
    const p = await run([1, 2], { type: 'mute' });
    expect((await db.subs.get(1))?.muted).toBe(true);
    await runUndo(p.undo);
    const after = await all();
    expect(after).toEqual(before);
    expect('muted' in after[0]).toBe(false);
  });
  it('used and cancel survive and undo', async () => {
    const before = await all();
    const u = await run([1, 4], { type: 'used', date: '2026-10-19' });
    const c = await run([1, 2], { type: 'cancel' });
    expect((await db.subs.get(4))?.lastUsedAt).toBe('2026-10-19');
    expect((await db.subs.get(2))?.selectedForCancel).toBe(true);
    await runUndo(c.undo); await runUndo(u.undo);
    expect(await all()).toEqual(before);
  });
  it('delete then undo brings back the complete rows with their ids', async () => {
    const before = await all();
    const p = await run([2, 3, 4, 5], { type: 'delete' });
    expect((await all()).map(s => s.id)).toEqual([1]);
    expect(await runUndo(p.undo)).toEqual({ restored: 4, skipped: 0 });
    expect(await all()).toEqual(before);
  });
  it('undo skips rows changed or deleted by something else and reports them', async () => {
    const p = await run([1, 2, 3], { type: 'category', category: 'Gaming' });
    await db.subs.update(2, { category: 'Software' });
    await db.subs.delete(3);
    expect(await runUndo(p.undo)).toEqual({ restored: 1, skipped: 2 });
    expect((await db.subs.get(1))?.category).toBe('Other');
    expect((await db.subs.get(2))?.category).toBe('Software'); // someone else's edit is never overwritten
  });
  it('a second undo of the same delete restores nothing and does not duplicate', async () => {
    const p = await run([2], { type: 'delete' });
    await runUndo(p.undo);
    expect(await runUndo(p.undo)).toEqual({ restored: 0, skipped: 1 });
    expect((await all()).filter(s => s.id === 2)).toHaveLength(1);
  });
});
