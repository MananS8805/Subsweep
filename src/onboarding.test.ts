import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { isSample, shouldShowOnboarding } from './onboarding';
import { db } from './db';
import { loadSampleData, removeSampleData, sampleSubscriptions } from './sampleData';
import { exportBackup, importBackup } from './backup';
import { loadSettings } from './settings';

beforeEach(async () => { await Promise.all([db.subs.clear(), db.dismissedDuplicates.clear(), db.settings.clear()]); });

describe('shouldShowOnboarding', () => {
  it('shows for an empty, undismissed SubSweep only', () => {
    expect(shouldShowOnboarding(0, { onboardingDismissed: false })).toBe(true);
    expect(shouldShowOnboarding(0, { onboardingDismissed: true })).toBe(false);
    expect(shouldShowOnboarding(1, { onboardingDismissed: false })).toBe(false);
    expect(shouldShowOnboarding(5, { onboardingDismissed: true })).toBe(false);
  });
});

describe('sample data', () => {
  it('has renewals in the future for every live row, whenever it is loaded', () => {
    for (const today of ['2026-10-20', '2027-03-01', '2028-02-29']) {
      for (const s of sampleSubscriptions(today).filter(r => !r.status)) expect(s.nextRenewal >= today).toBe(true);
    }
  });
  it('removing samples touches only samples', async () => {
    await loadSampleData('2026-10-20');
    const { sampleIds } = await loadSettings();
    // a real row added after (with a reused-looking id is impossible, so also try a real row listed in sampleIds)
    const real = await db.subs.add({ name: 'Mine', amount: 5, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false });
    expect(await removeSampleData([...sampleIds, real])).toBe(sampleIds.length);
    expect((await db.subs.toArray()).map(s => s.name)).toEqual(['Mine']);
  });
  it('is flagged, labelled and excluded from exports (and its ids with it)', async () => {
    await loadSampleData('2026-10-20');
    await db.subs.add({ name: 'Mine', amount: 5, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false });
    expect((await db.subs.toArray()).filter(isSample).length).toBe(sampleSubscriptions('2026-10-20').length);
    const b = await exportBackup();
    expect(b.subscriptions.map(s => s.name)).toEqual(['Mine']);
    expect(b.settings.sampleIds).toBeUndefined();
  });
});

describe('old backups', () => {
  it('import without onboardingDismissed or any new field', async () => {
    const text = JSON.stringify({ app: 'subsweep', version: 1, subscriptions: [{ id: 1, name: 'Old', amount: 1, cycle: 'monthly', nextRenewal: '2026-11-01', category: 'Other', isTrial: false }] });
    expect((await importBackup(text, 'replace')).added).toBe(1);
    expect((await loadSettings()).onboardingDismissed).toBe(false);
  });
  it('carries onboardingDismissed when present', async () => {
    const text = JSON.stringify({ app: 'subsweep', version: 2, subscriptions: [], settings: { onboardingDismissed: true } });
    await importBackup(text, 'replace');
    expect((await loadSettings()).onboardingDismissed).toBe(true);
  });
});
