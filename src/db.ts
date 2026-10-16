import Dexie, { type Table } from 'dexie';
import type { DismissedDuplicate, NotifiedReminder, Setting, Subscription } from './types';
import { localDate } from './dates';
import { DEFAULT_BASE, isCurrencyCode } from './currency';

export class SubDB extends Dexie {
  subs!: Table<Subscription, number>;
  dismissedDuplicates!: Table<DismissedDuplicate, number>;
  settings!: Table<Setting, string>;
  notifiedReminders!: Table<NotifiedReminder, string>;
  constructor(name = 'subsweep') {
    super(name);
    this.version(1).stores({ subs: '++id, name, nextRenewal' });
    // v2 only adds tables; existing `subs` rows are carried over untouched.
    this.version(2).stores({
      subs: '++id, name, nextRenewal',
      dismissedDuplicates: '++id, &key',
      settings: 'key',
    });
    // v3 (cancel & verify) adds only unindexed fields on subs, so the schema is unchanged and no rows move.
    this.version(3).stores({
      subs: '++id, name, nextRenewal',
      dismissedDuplicates: '++id, &key',
      settings: 'key',
    });
    // v4 (multi-currency): schema unchanged; existing rows get currency = the base currency, nothing else moves.
    this.version(4).stores({
      subs: '++id, name, nextRenewal',
      dismissedDuplicates: '++id, &key',
      settings: 'key',
    }).upgrade(async tx => {
      const stored = (await tx.table('settings').get('baseCurrency'))?.value;
      const base = isCurrencyCode(stored) ? stored : DEFAULT_BASE;
      if (stored !== base) await tx.table('settings').put({ key: 'baseCurrency', value: base });
      await tx.table('subs').toCollection().modify(s => { if (!s.currency) s.currency = base; });
    });
    // v5 (detection, import undo, reminders): adds the notifiedReminders table. Existing rows only gain a
    // one-entry price history built from their current price; nothing else moves.
    this.version(5).stores({
      subs: '++id, name, nextRenewal',
      dismissedDuplicates: '++id, &key',
      settings: 'key',
      notifiedReminders: 'key',
    }).upgrade(tx => tx.table('subs').toCollection().modify(s => {
      if (!Array.isArray(s.priceHistory) || !s.priceHistory.length) {
        s.priceHistory = [{ date: typeof s.createdAt === 'string' ? s.createdAt.slice(0, 10) : localDate(), amount: s.amount }];
      }
    }));
  }
}
export const db = new SubDB();
