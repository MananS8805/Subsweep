import { db } from './db';
import type { Subscription } from './types';

/** Every sample row carries this note, and the app shows a "sample data" banner while any of it is loaded. */
export const SAMPLE_NOTE = 'Sample data (fake)';
export const SAMPLE_BASE = 'INR';
export const SAMPLE_RATES = { USD: 83, EUR: 90 } as const;

const DAY = 86400000;
const shift = (today: string, days: number) => new Date(+new Date(today + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);

/**
 * Fake subscriptions for demos and screenshots. Dates are relative to `today` so the insights (unused,
 * trial ending, price creep, overlap) and the cancel & verify states look the same whenever it is loaded.
 */
export function sampleSubscriptions(today: string): Omit<Subscription, 'id'>[] {
  const at = (days: number) => shift(today, days);
  const stamp = (days: number) => `${at(days)}T09:00:00.000Z`;
  const base = { isTrial: false, notes: SAMPLE_NOTE };
  return [
    { ...base, name: 'Netflix', amount: 649, currency: 'INR', cycle: 'monthly', nextRenewal: at(5), category: 'Streaming', priceCreep: { from: 499, to: 649 }, priceHistory: [{ date: at(-220), amount: 499 }, { date: at(-95), amount: 649 }], createdAt: stamp(-220), lastUsedAt: at(-2) },
    { ...base, name: 'Hotstar', amount: 299, currency: 'INR', cycle: 'monthly', nextRenewal: at(13), category: 'Streaming', createdAt: stamp(-220), lastUsedAt: at(-4) },
    { ...base, name: 'Amazon Prime', amount: 1499, currency: 'INR', cycle: 'yearly', nextRenewal: at(120), category: 'Shopping', createdAt: stamp(-220), lastUsedAt: at(-5) },
    { ...base, name: 'Spotify', amount: 119, currency: 'INR', cycle: 'monthly', nextRenewal: at(2), category: 'Music', createdAt: stamp(-220), lastUsedAt: at(-1) },
    { ...base, name: 'Apple Music', amount: 99, currency: 'INR', cycle: 'monthly', nextRenewal: at(19), category: 'Music', createdAt: stamp(-180), lastUsedAt: at(-13) },
    { ...base, name: 'iCloud', amount: 75, currency: 'INR', cycle: 'monthly', nextRenewal: at(16), category: 'Cloud & Storage', createdAt: stamp(-220), lastUsedAt: at(-1) },
    { ...base, name: 'Dropbox', amount: 11.99, currency: 'USD', cycle: 'monthly', nextRenewal: at(25), category: 'Cloud & Storage', createdAt: stamp(-220), lastUsedAt: at(-74) },
    { ...base, name: 'Adobe Creative Cloud', amount: 54.99, currency: 'USD', cycle: 'monthly', nextRenewal: at(8), category: 'Software', createdAt: stamp(-220), lastUsedAt: at(-3) },
    { ...base, name: 'ChatGPT', amount: 20, currency: 'USD', cycle: 'monthly', nextRenewal: at(21), category: 'Software', createdAt: stamp(-160), lastUsedAt: at(0) },
    { ...base, name: 'Duolingo', amount: 12.99, currency: 'EUR', cycle: 'monthly', nextRenewal: at(29), category: 'Other', createdAt: stamp(-220), lastUsedAt: at(-86) },
    { ...base, name: 'Peloton', amount: 1999, currency: 'INR', cycle: 'monthly', nextRenewal: at(11), category: 'Fitness & Health', createdAt: stamp(-250), lastUsedAt: at(-106) },
    { ...base, name: 'Headspace', amount: 399, currency: 'INR', cycle: 'monthly', nextRenewal: at(3), category: 'Fitness & Health', isTrial: true, createdAt: stamp(-11) },
    // cancelled and confirmed by a later statement
    { ...base, name: 'Disney+', amount: 499, currency: 'INR', cycle: 'monthly', nextRenewal: at(-40), category: 'Streaming', createdAt: stamp(-220), status: 'cancelled', cancelRequestedAt: at(-55), cancelEffectiveDate: at(-40), cancelRef: 'DP-88231', verifiedAt: at(-4), zombieCharges: [] },
    // cancelled, but still being charged
    { ...base, name: 'Audible', amount: 199, currency: 'INR', cycle: 'monthly', nextRenewal: at(-30), category: 'Music', createdAt: stamp(-220), status: 'cancelled', cancelRequestedAt: at(-45), cancelEffectiveDate: at(-30), cancelRef: 'AUD-5521', zombieCharges: [{ date: at(-1), amount: 199 }] },
  ];
}

/**
 * Add the sample subscriptions. This only ever runs into an empty SubSweep, so fake rows can never mix with
 * real ones, and the ids are remembered so "Remove sample data" deletes exactly these rows.
 */
export async function loadSampleData(today: string): Promise<number> {
  return db.transaction('rw', db.subs, db.settings, async () => {
    if ((await db.subs.count()) > 0) throw new Error('Sample data can only be loaded when you have no subscriptions yet.');
    const ids = await db.subs.bulkAdd(sampleSubscriptions(today) as Subscription[], { allKeys: true });
    await db.settings.bulkPut([
      { key: 'baseCurrency', value: SAMPLE_BASE },
      { key: 'rates', value: { ...SAMPLE_RATES } },
      { key: 'ratesNeedReview', value: false },
      { key: 'sampleIds', value: ids },
    ]);
    return ids.length;
  });
}

export async function removeSampleData(ids: number[]): Promise<number> {
  return db.transaction('rw', db.subs, db.settings, async () => {
    const existing = (await db.subs.bulkGet(ids)).filter((s): s is Subscription => !!s && s.notes === SAMPLE_NOTE);
    await db.subs.bulkDelete(existing.map(s => s.id!));
    await db.settings.put({ key: 'sampleIds', value: [] });
    return existing.length;
  });
}
