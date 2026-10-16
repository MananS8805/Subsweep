export type Cycle = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export const CYCLES: Cycle[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
export const CYCLE_SHORT: Record<Cycle, string> = { weekly: 'wk', biweekly: '2wk', monthly: 'mo', quarterly: 'qtr', yearly: 'yr' };
export const CYCLE_LABEL: Record<Cycle, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
export interface Subscription {
  id?: number;
  name: string;
  amount: number;
  cycle: Cycle;
  nextRenewal: string; // YYYY-MM-DD
  category: string;
  isTrial: boolean;
  priceCreep?: { from: number; to: number } | null;
  notes?: string;
  createdAt?: string; // ISO timestamp; absent on v0.1 data
  priceHistory?: { date: string; amount: number }[]; // every distinct price over time, oldest first; the last entry is the current price
  confidence?: number;     // 0..1, how sure detection was when this came from a statement
  importBatchId?: string;  // set on rows added by one statement import, so that import can be undone
  muted?: boolean;         // no renewal reminders for this one
  snoozedUntil?: string;   // YYYY-MM-DD: no reminders until this local date
  currency?: string;          // ISO 4217; absent means the base currency
  selectedForCancel?: boolean; // ticked in the yearly view's savings simulator
  lastUsedAt?: string;        // YYYY-MM-DD, set by "Used recently"
  // Cancel & verify (v0.3). Absent status means active.
  status?: CancelStatus;
  cancelRequestedAt?: string;   // YYYY-MM-DD, when you asked to cancel
  cancelEffectiveDate?: string; // YYYY-MM-DD, paid-through date: no charge expected after this
  cancelRef?: string;           // confirmation number or note
  verifiedAt?: string;          // YYYY-MM-DD, a later statement showed no more charges
  zombieCharges?: { date: string; amount: number }[]; // charges seen after the cancellation took effect
}
export type CancelStatus = 'active' | 'cancelling' | 'cancelled';
/** A subscription you still pay for: counts toward totals, reminders and the calendar. */
export const isLive = (s: Subscription) => !s.status || s.status === 'active';
export interface DismissedDuplicate { id?: number; key: string } // key = "<smallerId>-<largerId>"
export interface Setting { key: string; value: unknown }
/** A reminder already shown, so it is never shown twice. key = "<subId>|<renewalDate>|<window>" */
export interface NotifiedReminder { key: string; renewalDate: string; at: string }
export interface Detected {
  name: string;
  amount: number;
  cycle: Cycle;
  lastDate: string;
  nextRenewal: string;
  occurrences: number;
  priceCreep: { from: number; to: number } | null;
  currency?: string; // seen in the statement's amount column, when it shows one
  firstDate: string;
  confidence: number; // 0..1; see confidenceLabel() in detect.ts
  priceHistory: { date: string; amount: number }[];
}
export const CATEGORIES = ['Streaming', 'Music', 'Software', 'Cloud & Storage', 'News & Reading', 'Fitness & Health', 'Gaming', 'Shopping', 'Finance', 'Other'];
