import { useRef } from 'react';
import { silencedReason, snoozeUntil } from './reminders';
import type { Subscription } from './types';

interface Props {
  sub: Subscription;
  now: string;                                   // local date, YYYY-MM-DD
  onChange: (patch: Partial<Subscription>) => void;
}

/** Short status shown next to the bell: nothing when reminders are normal. */
export function reminderStatus(s: Subscription, now: string): string {
  const why = silencedReason(s, now);
  return why === 'muted' ? 'Muted' : why === 'snoozed' ? `Snoozed until ${s.snoozedUntil}` : '';
}

/**
 * The bell on each subscription: mute, snooze for a day / 3 days / a week, or turn reminders back on.
 * A native <details> disclosure, so it is keyboard and screen-reader operable without any extra scripting.
 */
export default function ReminderMenu({ sub, now, onChange }: Props) {
  const box = useRef<HTMLDetailsElement>(null);
  const why = silencedReason(sub, now);
  const status = reminderStatus(sub, now);
  const apply = (patch: Partial<Subscription>) => { onChange(patch); if (box.current) box.current.open = false; };

  return (
    <details ref={box} className="bell-menu">
      <summary aria-label={`Reminders for ${sub.name}${status ? `: ${status}` : ''}`}>
        <span aria-hidden="true">{why === 'muted' ? '🔕' : '🔔'}</span>
        <span className="bell-label">{status || 'Reminders'}</span>
      </summary>
      <div className="bell-pop" role="group" aria-label={`Reminder options for ${sub.name}`}>
        {why && <button className="link" onClick={() => apply({ muted: false, snoozedUntil: undefined })}>{why === 'muted' ? 'Unmute reminders' : 'End snooze'}</button>}
        {why !== 'muted' && <button className="link" onClick={() => apply({ muted: true, snoozedUntil: undefined })}>Mute reminders</button>}
        <button className="link" onClick={() => apply({ muted: false, snoozedUntil: snoozeUntil(now, 1) })}>Snooze 1 day</button>
        <button className="link" onClick={() => apply({ muted: false, snoozedUntil: snoozeUntil(now, 3) })}>Snooze 3 days</button>
        <button className="link" onClick={() => apply({ muted: false, snoozedUntil: snoozeUntil(now, 7) })}>Snooze 1 week</button>
      </div>
    </details>
  );
}
