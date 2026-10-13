import Dexie, { type Table } from 'dexie';
import type { DismissedDuplicate, Setting, Subscription } from './types';

export class SubDB extends Dexie {
  subs!: Table<Subscription, number>;
  dismissedDuplicates!: Table<DismissedDuplicate, number>;
  settings!: Table<Setting, string>;
  constructor(name = 'subsweep') {
    super(name);
    this.version(1).stores({ subs: '++id, name, nextRenewal' });
    // v2 only adds tables; existing `subs` rows are carried over untouched.
    this.version(2).stores({
      subs: '++id, name, nextRenewal',
      dismissedDuplicates: '++id, &key',
      settings: 'key',
    });
  }
}
export const db = new SubDB();
