import { useState } from 'react';
import Modal from './Modal';
import { CYCLES, CYCLE_LABEL, type Cycle, type Subscription } from './types';
import { findLookalike, validateSubscription } from './validate';

interface Props {
  existing: Subscription[];
  base: string;
  today: string;
  categoryFor: (name: string) => string;
  onAdd: (s: Subscription) => void;
  onMore: (draft: Subscription) => void;
  onClose: () => void;
}

/** The fastest way to add one: name, price, cycle, next date. Everything else can be filled in later. */
export default function QuickAdd({ existing, base, today, categoryFor, onAdd, onMore, onClose }: Props) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const [next, setNext] = useState(today);
  const [error, setError] = useState('');
  const [warned, setWarned] = useState<Subscription | null>(null);

  const draft = (): Subscription => ({ name: name.trim(), amount: Number(amount), cycle, nextRenewal: next, category: categoryFor(name), isTrial: false, currency: base });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const d = draft();
    const problem = validateSubscription(d);
    if (problem) { setError(problem); setWarned(null); return; }
    const twin = findLookalike(d, existing);
    if (twin && warned?.id !== twin.id) { setWarned(twin); setError(''); return; }
    onAdd(d);
  }

  return (
    <Modal title="Quick add" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <label>Name<input value={name} onChange={e => { setName(e.target.value); setWarned(null); }} autoComplete="off" /></label>
        <div className="two">
          <label>Amount ({base})<input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setWarned(null); }} /></label>
          <label>Billing cycle
            <select value={cycle} onChange={e => setCycle(e.target.value as Cycle)}>{CYCLES.map(c => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}</select></label>
        </div>
        <label>Next renewal<input type="date" value={next} onChange={e => setNext(e.target.value)} /></label>
        <div aria-live="assertive">
          {error && <p className="error" role="alert">{error}</p>}
          {warned && <p className="notice" role="alert">You already track <b>{warned.name}</b> at a similar price. Add it anyway?</p>}
        </div>
        <div className="row-actions">
          <button type="button" className="link" onClick={() => onMore(draft())}>More details…</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{warned ? 'Add anyway' : 'Add'}</button>
        </div>
      </form>
    </Modal>
  );
}
