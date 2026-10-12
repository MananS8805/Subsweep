import Dexie, { type Table } from 'dexie';
import type { Subscription } from './types';

class SubDB extends Dexie {
  subs!: Table<Subscription, number>;
  constructor() { super('subsweep'); this.version(1).stores({ subs: '++id, name, nextRenewal' }); }
}
export const db = new SubDB();
