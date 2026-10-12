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
}
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
