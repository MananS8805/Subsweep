import { useState } from 'react';
import Modal from './Modal';
import PaymentField from './PaymentField';
import { normalizeLabel, validateLabel } from './paymentMethods';

interface Props {
  count: number;
  labels: string[];
  onApply: (label: string) => void;
  onClose: () => void;
}

/** Ask for one payment-method label to give to every selected subscription. */
export default function MethodDialog({ count, labels, onApply, onClose }: Props) {
  const [value, setValue] = useState('');
  const bad = validateLabel(value);
  const label = normalizeLabel(value);
  return (
    <Modal title="Set payment method" onClose={onClose}>
      <form className="form" onSubmit={e => { e.preventDefault(); if (!bad && label) onApply(label); }}>
        <p className="muted">This label will be set on {count} selected subscription{count === 1 ? '' : 's'}. You can undo it afterwards.</p>
        <PaymentField value={value} onChange={setValue} labels={labels} />
        <div className="row-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!!bad || !label}>Set for {count}</button>
        </div>
      </form>
    </Modal>
  );
}
