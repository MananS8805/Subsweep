import type { Subscription } from './types';


const esc = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const compact = (d: string) => d.replace(/-/g, '');
const nextDay = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return compact(x.toISOString().slice(0, 10)); };

/** Build an .ics calendar with a renewal event (+1-day-before alarm) for each subscription. */
export function buildIcs(subs: Subscription[]): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SubSweep//EN', 'CALSCALE:GREGORIAN'];
  for (const s of subs) {
    const rrule = { weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', quarterly: 'FREQ=MONTHLY;INTERVAL=3', yearly: 'FREQ=YEARLY' } as const;
    lines.push(
      'BEGIN:VEVENT',
      `UID:subsweep-${s.id ?? s.name}-${compact(s.nextRenewal)}@subsweep.local`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;VALUE=DATE:${compact(s.nextRenewal)}`,
      `DTEND;VALUE=DATE:${nextDay(s.nextRenewal)}`,
      s.isTrial ? 'RRULE:FREQ=YEARLY;COUNT=1' : `RRULE:${rrule[s.cycle]}`,
      `SUMMARY:${esc(`${s.isTrial ? 'Trial ends' : 'Renews'}: ${s.name} ($${s.amount.toFixed(2)})`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(s.name)} renews tomorrow`, 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
