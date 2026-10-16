import type { Cycle, Detected, Subscription } from './types';
import { addCycle, confidenceLabel, nextOnOrAfter, type ConfidenceLabel } from './detect';
import { isAlreadyTracked } from './dedupe';

/** One row of the import preview. Lives in memory only; nothing is saved until the user confirms. */
export interface PreviewItem {
  key: string;                 // stable id within this preview
  name: string;
  amount: number;
  detectedAmount: number;      // what the statement said, so an edit can be recorded in the price history
  cycle: Cycle;
  category: string;
  currency: string;
  lastDate: string;
  occurrences: number;
  confidence: number;
  label: ConfidenceLabel;
  priceHistory: { date: string; amount: number }[];
  priceCreep: { from: number; to: number } | null;
  checked: boolean;
  alreadyTracked: boolean;     // matches a subscription you already have: unchecked and cannot be selected
}

/** High and Medium confidence start ticked; Low starts unticked so it is a deliberate choice. */
export const defaultChecked = (label: ConfidenceLabel): boolean => label === 'High' || label === 'Medium';

/** Build the preview: most confident first, and anything already tracked last, unchecked and disabled. */
export function buildPreview(
  detected: Detected[], existing: Subscription[], categoryOf: (name: string) => string, base: string,
): PreviewItem[] {
  const items = detected.map<PreviewItem>((d, i) => {
    const label = confidenceLabel(d.confidence);
    const tracked = isAlreadyTracked(d.name, existing);
    return {
      key: `${i}-${d.name}`, name: d.name, amount: d.amount, detectedAmount: d.amount, cycle: d.cycle,
      category: categoryOf(d.name), currency: d.currency ?? base, lastDate: d.lastDate, occurrences: d.occurrences,
      confidence: d.confidence, label, priceHistory: d.priceHistory, priceCreep: d.priceCreep,
      checked: !tracked && defaultChecked(label), alreadyTracked: tracked,
    };
  });
  return items.sort((a, b) => Number(a.alreadyTracked) - Number(b.alreadyTracked) || b.confidence - a.confidence);
}

/** A row can be added when it has a name and a positive amount. */
export const isValid = (i: PreviewItem) => i.name.trim().length > 0 && Number.isFinite(i.amount) && i.amount > 0;

/** What "Add N selected" will add. Tracked rows can never be selected, even if something ticks them. */
export const selectedItems = (items: PreviewItem[]): PreviewItem[] => items.filter(i => i.checked && !i.alreadyTracked && isValid(i));

export const newBatchId = (now = Date.now()): string => `import-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Turn the chosen rows into subscriptions, all stamped with the same batch id so the import can be undone. */
export function toSubscriptions(items: PreviewItem[], batchId: string, nowIso: string, today: string): Subscription[] {
  return selectedItems(items).map<Subscription>(i => {
    // an edited amount is the user saying what the price is now: record it as the latest price
    const history = i.priceHistory.length ? [...i.priceHistory] : [{ date: i.lastDate, amount: i.detectedAmount }];
    if (Math.abs(history[history.length - 1].amount - i.amount) > 0.005) history.push({ date: i.lastDate, amount: i.amount });
    return {
      name: i.name.trim(), amount: i.amount, cycle: i.cycle, category: i.category, currency: i.currency, isTrial: false,
      nextRenewal: nextOnOrAfter(addCycle(i.lastDate, i.cycle), i.cycle, today),
      priceCreep: i.priceCreep, priceHistory: history, confidence: i.confidence, createdAt: nowIso, importBatchId: batchId,
    };
  });
}

/** Ids of the rows added by one import. Rows without a batch id (or with another one) are never included. */
export const idsInBatch = (subs: Subscription[], batchId: string): number[] =>
  subs.filter(s => s.importBatchId === batchId && s.id !== undefined).map(s => s.id!);

/** "Added 3 subscriptions" style summary used by the toast and the live region. */
export const addedMessage = (n: number) => `Added ${n} subscription${n === 1 ? '' : 's'}.`;
