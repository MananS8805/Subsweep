import { useId } from 'react';
import { METHOD_HINT, METHOD_MAX, validateLabel } from './paymentMethods';

interface Props {
  value: string;
  onChange: (v: string) => void;
  labels: string[];           // previously used labels, offered as suggestions
}

/** Optional payment-method nickname with suggestions. A card-number-like entry is refused right away, in a live region. */
export default function PaymentField({ value, onChange, labels }: Props) {
  const list = useId(), hint = useId();
  const problem = validateLabel(value);
  return (
    <div className="pay-field">
      <label>Payment method (optional)
        <input list={list} value={value} maxLength={METHOD_MAX * 2} autoComplete="off" aria-describedby={hint} aria-invalid={problem ? true : undefined}
          onChange={e => onChange(e.target.value)} />
      </label>
      <datalist id={list}>{labels.map(l => <option key={l} value={l} />)}</datalist>
      <p id={hint} className="muted pay-hint"><small>{METHOD_HINT}</small></p>
      <div aria-live="assertive">{problem && <p className="error" role="alert">{problem}</p>}</div>
    </div>
  );
}
