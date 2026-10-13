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
}
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
