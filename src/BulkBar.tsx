import { CATEGORIES } from './types';

interface Props {
  count: number;          // selected
  visible: number;        // how many are on screen to select
  onCategory: (category: string) => void;
  onUsed: () => void;
  onMute: () => void;
  onCancel: () => void;   // "Mark Cancel?"
  onMethod: () => void;   // opens the payment-method dialog
  onDelete: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

/** The action bar for select mode. Every action needs a selection, so with nothing selected they are all disabled. */
export default function BulkBar({ count, visible, onCategory, onUsed, onMute, onCancel, onMethod, onDelete, onSelectAll, onClear }: Props) {
  const none = count === 0;
  return (
    <div className="bulk-bar" id="bulk-bar" role="toolbar" aria-label="Bulk actions" tabIndex={-1}>
      <strong className="bulk-count" role="status">{count} selected</strong>
      <select aria-label="Set category for selected subscriptions" value="" disabled={none} onChange={e => { if (e.target.value) onCategory(e.target.value); }}>
        <option value="">Set category…</option>
        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <button className="btn" disabled={none} onClick={onUsed}>Mark used recently</button>
      <button className="btn" disabled={none} onClick={onMute}>Mute reminders</button>
      <button className="btn" disabled={none} onClick={onCancel}>Mark Cancel?</button>
      <button className="btn" disabled={none} onClick={onMethod}>Set payment method</button>
      <button className="btn danger-btn" disabled={none} onClick={onDelete}>Delete</button>
      <span className="bulk-sep" aria-hidden="true" />
      <button className="btn" disabled={visible === 0 || count === visible} onClick={onSelectAll}>Select all ({visible})</button>
      <button className="btn" disabled={none} onClick={onClear}>Clear</button>
    </div>
  );
}
