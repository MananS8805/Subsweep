import { isLive, type Subscription } from './types';
import { normalizeName } from './dedupe';
import { monthlyCost } from './detect';
import { convert, type Rates } from './currency';
import { yearlyCost, subCurrency } from './savings';

export type InsightType = 'overlap' | 'unused' | 'creep' | 'trial';
export interface Insight {
  id: string;                    // stable, includes the involved subscription ids: a changed set is a new insight
  type: InsightType;
  title: string;
  detail: string;
  subIds: number[];
  potentialYearlySaving: number; // in the base currency
}
export interface InsightContext { base: string; rates: Rates }

export const UNUSED_AFTER_DAYS = 60;     // last marked used more than this long ago
export const NEVER_USED_AFTER_DAYS = 45; // never marked used, and tracked for longer than this

// Group -> normalized name prefixes (spaces and punctuation removed, see normalizeName).
export const OVERLAP_GROUPS: Record<string, { label: string; keys: string[] }> = {
  music: { label: 'music', keys: ['spotify', 'applemusic', 'youtubemusic', 'youtubepremium', 'amazonmusic', 'tidal', 'pandora', 'deezer', 'jiosaavn', 'gaana', 'wynk'] },
  video: { label: 'video streaming', keys: ['netflix', 'primevideo', 'amazonprime', 'prime', 'disney', 'hotstar', 'jiohotstar', 'hbo', 'max', 'hulu', 'paramount', 'peacock', 'appletv', 'zee5', 'sonyliv', 'youtubepremium', 'crunchyroll'] },
  storage: { label: 'cloud storage', keys: ['icloud', 'googleone', 'dropbox', 'onedrive', 'pcloud', 'box'] },
  news: { label: 'news', keys: ['nytimes', 'newyorktimes', 'washingtonpost', 'wsj', 'wallstreetjournal', 'theatlantic', 'economist', 'financialtimes', 'ft', 'medium', 'substack', 'theathletic'] },
  fitness: { label: 'fitness', keys: ['planetfitness', 'anytimefitness', 'peloton', 'strava', 'fitbod', 'cultfit', 'gym', 'fitnessfirst', 'lafitness'] },
  design: { label: 'design tools', keys: ['adobe', 'canva', 'figma', 'sketch', 'affinity'] },
};

const DAY = 86400000;
export const daysBetween = (fromIso: string, toIso: string) => Math.floor((+new Date(toIso.slice(0, 10) + 'T00:00:00Z') - +new Date(fromIso.slice(0, 10) + 'T00:00:00Z')) / DAY);

// Short keys (max, box, ft) must match the whole name so "Maxis" or "Boxing Club" are not mistaken for them.
const matches = (n: string, key: string) => (key.length <= 3 ? n === key : n.startsWith(key));

export const groupsOf = (name: string): string[] => {
  const n = normalizeName(name);
  if (!n) return [];
  return Object.entries(OVERLAP_GROUPS).filter(([, g]) => g.keys.some(k => matches(n, k))).map(([id]) => id);
};

const yc = (s: Subscription, ctx: InsightContext) => yearlyCost({ ...s, isTrial: false }, ctx.base, ctx.rates) ?? 0;

export function getInsights(subs: Subscription[], now: string, ctx: InsightContext = { base: 'INR', rates: {} }): Insight[] {
  const live = subs.filter(s => isLive(s) && s.id !== undefined);
  const out: Insight[] = [];

  // Overlap: 2+ paid (non-trial) subscriptions in the same group. Keep the priciest, the rest are the saving.
  for (const [gid, g] of Object.entries(OVERLAP_GROUPS)) {
    const members = live.filter(s => !s.isTrial && groupsOf(s.name).includes(gid));
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => yc(b, ctx) - yc(a, ctx) || a.id! - b.id!);
    const rest = ranked.slice(1);
    const saving = rest.reduce((t, s) => t + yc(s, ctx), 0);
    const ids = members.map(s => s.id!).sort((a, b) => a - b);
    out.push({
      id: `overlap:${gid}:${ids.join(',')}`, type: 'overlap',
      title: `${members.length} ${g.label} subscriptions`,
      detail: `${members.map(s => s.name).join(', ')}. Keeping only ${ranked[0].name} would save the other ${rest.length === 1 ? 'one' : rest.length}.`,
      subIds: ranked.slice(1).map(s => s.id!), potentialYearlySaving: saving,
    });
  }

  // Unused: not marked used for 60+ days, or never marked and tracked for 45+ days.
  for (const s of live) {
    if (s.isTrial) continue;
    let detail = '';
    if (s.lastUsedAt) {
      const days = daysBetween(s.lastUsedAt, now);
      if (days > UNUSED_AFTER_DAYS) detail = `You last marked it used ${days} days ago.`;
    } else {
      const age = s.createdAt ? daysBetween(s.createdAt, now) : Infinity; // legacy rows have no createdAt
      if (age > NEVER_USED_AFTER_DAYS) detail = 'You have never marked it as used. Tap "Used recently" if you still use it.';
    }
    if (detail) out.push({ id: `unused:${s.id}`, type: 'unused', title: `${s.name}: not marked used lately`, detail, subIds: [s.id!], potentialYearlySaving: yc(s, ctx) });
  }

  // Price creep: the extra you now pay each year.
  for (const s of live) {
    if (!s.priceCreep || s.isTrial) continue;
    const extra = convert(monthlyCost(s.priceCreep.to - s.priceCreep.from, s.cycle) * 12, subCurrency(s, ctx.base), ctx.base, ctx.rates) ?? 0;
    if (extra <= 0) continue;
    out.push({
      id: `creep:${s.id}:${s.priceCreep.from}-${s.priceCreep.to}`, type: 'creep',
      title: `${s.name} got more expensive`, detail: `The price went from ${s.priceCreep.from} to ${s.priceCreep.to}.`,
      subIds: [s.id!], potentialYearlySaving: extra,
    });
  }

  // Trials about to convert into a paid plan.
  for (const s of live) {
    if (!s.isTrial) continue;
    const left = daysBetween(now, s.nextRenewal);
    if (left < 0 || left > 7) continue;
    out.push({
      id: `trial:${s.id}:${s.nextRenewal}`, type: 'trial',
      title: `${s.name} trial ends ${left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}`,
      detail: 'Cancel before it converts to a paid plan if you do not want it.',
      subIds: [s.id!], potentialYearlySaving: yc(s, ctx),
    });
  }

  return out.sort((a, b) => b.potentialYearlySaving - a.potentialYearlySaving || a.id.localeCompare(b.id));
}

/** Drop insights the user dismissed. A changed underlying set has a new id, so it comes back by itself. */
export const visibleInsights = (all: Insight[], dismissed: Iterable<string>): Insight[] => {
  const gone = new Set(dismissed);
  return all.filter(i => !gone.has(i.id));
};
