export type Cycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
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
  priceHistory?: { date: string; amount: number }[];
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
export interface Detected {
  name: string;
  amount: number;
  cycle: Cycle;
  lastDate: string;
  nextRenewal: string;
  occurrences: number;
  priceCreep: { from: number; to: number } | null;
}
export const CATEGORIES = ['Streaming', 'Music', 'Software', 'Cloud & Storage', 'News & Reading', 'Fitness & Health', 'Gaming', 'Shopping', 'Finance', 'Other'];
