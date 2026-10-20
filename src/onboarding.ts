import { SAMPLE_BATCH } from './sampleData';
import type { Subscription } from './types';

/** Rows added by "Try with sample data". They are fake, labelled in the UI, and never exported. */
export const isSample = (s: Pick<Subscription, 'importBatchId'>): boolean => s.importBatchId === SAMPLE_BATCH;

/** The welcome panel shows only for an empty SubSweep whose owner has not dismissed it. */
export const shouldShowOnboarding = (count: number, settings: { onboardingDismissed: boolean }): boolean =>
  count === 0 && !settings.onboardingDismissed;
