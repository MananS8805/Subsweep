// Short, generic "how to cancel" pointers. Always verify on the provider's site.
const GUIDES: Record<string, string> = {
  netflix: 'Account → Membership & Billing → Cancel Membership.',
  spotify: 'Account page (web) → Your plan → Change plan → Cancel Premium.',
  hulu: 'Account → Cancel (under Your Subscription).',
  disney: 'Account → Subscription → Cancel Subscription.',
  'apple': 'Settings → [your name] → Subscriptions → pick the app → Cancel.',
  google: 'play.google.com → Payments & subscriptions → Subscriptions → Cancel.',
  amazon: 'Account & Lists → Memberships & Subscriptions → Manage → End membership.',
  youtube: 'YouTube → Paid memberships → Manage membership → Deactivate.',
  adobe: 'adobe.com → Account → Plans → Manage plan → Cancel (watch the early-termination fee).',
  microsoft: 'account.microsoft.com/services → Manage → Cancel subscription.',
  dropbox: 'Settings → Plan → Cancel plan.',
  icloud: 'Settings → [your name] → iCloud → Manage Storage → Change Storage Plan.',
  hbo: 'Max/HBO: Profile → Subscription → Manage Subscription → Cancel.',
  max: 'Profile → Subscription → Manage Subscription → Cancel.',
  audible: 'Account Details → Cancel membership.',
  peloton: 'Settings → Membership → Cancel Membership.',
};
export function cancelHint(name: string): string {
  const n = name.toLowerCase();
  for (const k of Object.keys(GUIDES)) if (n.includes(k)) return GUIDES[k];
  return `Look for Account/Billing → Subscription/Membership → Cancel on ${name}'s site or app. If you subscribed via Apple or Google, cancel there. Failing that, contact support and ask for written confirmation.`;
}
