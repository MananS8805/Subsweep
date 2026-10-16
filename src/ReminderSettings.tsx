import { REMINDER_WINDOWS, TRIAL_FLOOR_DAYS } from './reminders';

interface Props {
  windows: number[];
  notifState: string;                 // Notification.permission, or "unsupported"
  onToggle: (days: number, on: boolean) => void;
  onAskPermission: () => void;
}

/** Which days before a renewal to be reminded, and whether the browser may show notifications. */
export default function ReminderSettings({ windows, notifState, onToggle, onAskPermission }: Props) {
  return (
    <section className="card" id="reminder-settings" aria-labelledby="reminder-settings-title">
      <h2 id="reminder-settings-title">Reminders</h2>
      <fieldset className="windows">
        <legend>Remind me before a renewal</legend>
        {REMINDER_WINDOWS.map(d => (
          <label key={d} className="check-pill">
            <input type="checkbox" checked={windows.includes(d)} onChange={e => onToggle(d, e.target.checked)} />
            <span>{d === 1 ? '1 day' : `${d} days`} before</span>
          </label>
        ))}
      </fieldset>
      <p className="muted">
        Free trials ending within {TRIAL_FLOOR_DAYS} days always remind you. Mute or snooze any subscription with its bell.
        Muted and snoozed items still count in your totals. Reminders appear when you open SubSweep.
      </p>
      {notifState === 'granted' && <p className="notice">Browser notifications are on.</p>}
      {notifState === 'default' && <div className="actions"><button className="btn" onClick={onAskPermission}>Turn on browser notifications</button></div>}
      {notifState === 'denied' && <p className="muted">Browser notifications are blocked for this site, so reminders show inside SubSweep only. You can allow them in your browser's site settings.</p>}
      {notifState === 'unsupported' && <p className="muted">This browser cannot show notifications, so reminders show inside SubSweep only.</p>}
    </section>
  );
}
