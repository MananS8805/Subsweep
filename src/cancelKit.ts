import { cancelHint } from './cancelGuides';
import type { Subscription } from './types';

export type Difficulty = 'easy' | 'hard' | 'phone';
export interface Kit { steps: string; difficulty: Difficulty; link?: string; note?: string }

// Direct account pages and known friction. Always confirm on the provider's site.
const EXTRA: [RegExp, Pick<Kit, 'difficulty' | 'link' | 'note'>][] = [
  [/netflix/, { difficulty: 'easy', link: 'https://www.netflix.com/cancelplan' }],
  [/spotify/, { difficulty: 'easy', link: 'https://www.spotify.com/account/subscription/' }],
  [/hulu/, { difficulty: 'easy', link: 'https://secure.hulu.com/account' }],
  [/disney/, { difficulty: 'easy', link: 'https://www.disneyplus.com/account' }],
  [/youtube/, { difficulty: 'easy', link: 'https://www.youtube.com/paid_memberships' }],
  [/dropbox/, { difficulty: 'easy', link: 'https://www.dropbox.com/account/plan' }],
  [/audible/, { difficulty: 'easy', link: 'https://www.audible.com/account/overview' }],
  [/microsoft/, { difficulty: 'easy', link: 'https://account.microsoft.com/services' }],
  [/apple|icloud/, { difficulty: 'easy', link: 'https://apps.apple.com/account/subscriptions', note: 'Billed through Apple, so cancel there rather than with the app maker.' }],
  [/google/, { difficulty: 'easy', link: 'https://play.google.com/store/account/subscriptions', note: 'Billed through Google Play, so cancel there.' }],
  [/amazon|prime/, { difficulty: 'hard', link: 'https://www.amazon.com/gp/primecentral', note: 'Expect several "are you sure?" screens before the final cancel button.' }],
  [/adobe/, { difficulty: 'hard', link: 'https://account.adobe.com/plans', note: 'Annual plans billed monthly can carry an early-termination fee. Check the amount before confirming.' }],
  [/fitness|gym|peloton|anytime|la fitness|24 hour|crunch/, { difficulty: 'phone', note: 'Gym contracts often need an in-person visit, a call or a mailed letter. Check your agreement and keep proof.' }],
];

export function cancelKit(name: string): Kit {
  const n = name.toLowerCase();
  const extra = EXTRA.find(([re]) => re.test(n))?.[1];
  return { steps: cancelHint(name), difficulty: extra?.difficulty ?? 'easy', link: extra?.link, note: extra?.note };
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Usually easy', hard: 'Known to be tricky', phone: 'May need a call or visit' };

export interface Ctx {
  name: string;
  amount: number;
  requestedAt: string;
  effectiveDate: string;
  ref?: string;
}
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const refLine = (ref?: string) => (ref?.trim() ? `Confirmation/reference: ${ref.trim()}\n` : '');

export const ctxOf = (s: Subscription): Ctx => ({
  name: s.name, amount: s.amount, requestedAt: s.cancelRequestedAt ?? '', effectiveDate: s.cancelEffectiveDate ?? '', ref: s.cancelRef,
});

export function cancelEmail(c: Ctx): string {
  return `Subject: Cancel my ${c.name} subscription

Hello,

Please cancel my ${c.name} subscription (${usd(c.amount)} per billing period) effective ${c.effectiveDate || 'the end of my current billing period'}, and do not charge my payment method again after that date.

Please reply to confirm the cancellation in writing, including the date it takes effect.

Thank you.
`;
}

export function chatScript(c: Ctx): string {
  return `1. "I'd like to cancel my ${c.name} subscription effective ${c.effectiveDate || 'the end of this billing period'}."
2. If offered a discount or pause: "No thank you, I just want to cancel."
3. "Please confirm it is cancelled and that I will not be charged again."
4. Ask for a confirmation number or an email confirmation, and save a screenshot of the chat.`;
}

export interface Charge { date: string; amount: number }
export function disputeMessage(c: Ctx, charges: Charge[]): string {
  const list = charges.map(x => `  - ${usd(x.amount)} on ${x.date}`).join('\n');
  return `Subject: Charged after cancelling ${c.name}

Hello,

I cancelled my ${c.name} subscription${c.requestedAt ? ` on ${c.requestedAt}` : ''}${c.effectiveDate ? `, effective ${c.effectiveDate}` : ''}.
${refLine(c.ref)}
My statement shows I was still charged after that date:
${list}

Please refund ${charges.length > 1 ? 'these charges' : 'this charge'} and confirm in writing that the subscription is cancelled. If I do not hear back within 7 days, I will ask my card issuer or bank to dispute ${charges.length > 1 ? 'them' : 'it'}.

Thank you.
`;
}
