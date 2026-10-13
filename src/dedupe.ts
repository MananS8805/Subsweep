import type { Subscription } from './types';

const SUFFIXES = new Set(['inc', 'ltd', 'llc', 'co', 'corp', 'com', 'www', 'payment', 'payments', 'pay']);

/** Lowercase, strip punctuation, spaces and common company suffixes ("Netflix.com Inc" -> "netflix"). */
export function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(w => w && !SUFFIXES.has(w))
    .join('');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

const amountsClose = (a: number, b: number) => Math.abs(a - b) <= 0.05 * Math.max(a, b);

export const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function isDuplicate(a: Subscription, b: Subscription): boolean {
  const na = normalizeName(a.name), nb = normalizeName(b.name);
  if (!na || !nb) return false;
  const exact = na === nb;
  if (!exact && similarity(na, nb) < 0.85) return false;
  const close = amountsClose(a.amount, b.amount);
  // A trial and its paid plan are different things unless the prices line up.
  if (a.isTrial !== b.isTrial && !close) return false;
  return close || exact;
}

/**
 * Groups of likely duplicates (2+ items each). `dismissed` holds pair keys the user has rejected;
 * a dismissed pair is never linked directly, though it can still share a group through a third item.
 */
export function findDuplicates(subs: Subscription[], dismissed: Iterable<string> = []): Subscription[][] {
  const skip = new Set(dismissed);
  const items = subs.filter(s => s.id !== undefined);
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (skip.has(pairKey(items[i].id!, items[j].id!))) continue;
      if (isDuplicate(items[i], items[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Subscription[]>();
  items.forEach((s, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(s); });
  return [...groups.values()].filter(g => g.length > 1);
}

/** Every pair key inside a group, used to remember a "Dismiss". */
export function groupPairKeys(group: Subscription[]): string[] {
  const keys: string[] = [];
  for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) keys.push(pairKey(group[i].id!, group[j].id!));
  return keys;
}

const age = (s: Subscription) => s.createdAt ?? ''; // v0.1 rows have no createdAt: treat as oldest, order by id
const byAge = (a: Subscription, b: Subscription) => age(a).localeCompare(age(b)) || (a.id ?? 0) - (b.id ?? 0);

/**
 * Merge a group into one record. Keeps the oldest record's identity and createdAt, takes the
 * current price/cycle/renewal from the newest record, records superseded prices in priceHistory,
 * and keeps manual edits (a non-default category, notes) from whichever record has them.
 */
export function mergeSubscriptions(group: Subscription[]): { keep: Subscription; removeIds: number[] } {
  if (group.length < 2) throw new Error('Nothing to merge.');
  const sorted = [...group].sort(byAge);
  const oldest = sorted[0], newest = sorted[sorted.length - 1];
  const history = new Map<string, { date: string; amount: number }>();
  const addHistory = (date: string, amount: number) => { history.set(`${date}|${amount}`, { date, amount }); };
  for (const s of sorted) {
    s.priceHistory?.forEach(h => addHistory(h.date, h.amount));
    if (s !== newest && s.amount !== newest.amount) addHistory((s.createdAt ?? '').slice(0, 10), s.amount);
  }
  const keep: Subscription = {
    ...oldest,
    amount: newest.amount,
    cycle: newest.cycle,
    nextRenewal: newest.nextRenewal,
    isTrial: newest.isTrial,
    priceCreep: newest.priceCreep ?? oldest.priceCreep ?? null,
    category: sorted.find(s => s.category && s.category !== 'Other')?.category ?? oldest.category,
    notes: sorted.find(s => s.notes?.trim())?.notes,
  };
  if (oldest.createdAt) keep.createdAt = oldest.createdAt;
  else delete keep.createdAt;
  if (history.size) keep.priceHistory = [...history.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (keep.notes === undefined) delete keep.notes;
  return { keep, removeIds: sorted.slice(1).map(s => s.id!) };
}

/** A detected charge that is already tracked: same normalized name as an existing subscription. */
export const isAlreadyTracked = (name: string, existing: Subscription[]) => {
  const n = normalizeName(name);
  return existing.some(s => normalizeName(s.name) === n);
};
