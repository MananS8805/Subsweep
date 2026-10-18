import { useRef, useState } from 'react';
import Modal from './Modal';
import BrandLogo from './BrandLogo';
import { CYCLE_LABEL, type Subscription } from './types';
import type { ReviewDecision } from './review';

interface Props {
  queue: Subscription[];                                   // a snapshot taken when the review starts
  money: (n: number, currency?: string) => string;
  onDecide: (s: Subscription, d: ReviewDecision) => Promise<void>;
  onFinish: (counts: Record<ReviewDecision, number>) => void;
}

/** One subscription at a time: Keep, Cancel? or Skip. Each choice is saved straight away, so closing midway loses nothing. */
export default function ReviewDialog({ queue, money, onDecide, onFinish }: Props) {
  const [i, setI] = useState(0);
  const [counts, setCounts] = useState<Record<ReviewDecision, number>>({ keep: 0, cancel: 0, skip: 0 });
  const busy = useRef(false);
  const done = i >= queue.length;
  const s = queue[i];

  async function decide(d: ReviewDecision) {
    if (busy.current || !s) return;
    busy.current = true;
    try { await onDecide(s, d); setCounts(c => ({ ...c, [d]: c[d] + 1 })); setI(n => n + 1); }
    finally { busy.current = false; }
  }

  return (
    <Modal title="Monthly review" onClose={() => onFinish(counts)}>
      {done ? (
        <>
          <p role="status"><b>Review finished.</b> Kept {counts.keep}, marked {counts.cancel} to cancel, skipped {counts.skip}.</p>
          {counts.cancel > 0 && <p className="muted">The ones you marked appear in the Yearly view, where you can see what cancelling would save.</p>}
          <div className="row-actions"><button className="btn primary" onClick={() => onFinish(counts)}>Done</button></div>
        </>
      ) : (
        <>
          <p className="muted" role="status">{i + 1} of {queue.length}</p>
          <div className="with-logo">
            <BrandLogo name={s.name} size={56} />
            <div>
              <h3>{s.name}</h3>
              <p className="muted">{money(s.amount, s.currency)} · {CYCLE_LABEL[s.cycle].toLowerCase()} · next {s.nextRenewal}</p>
            </div>
          </div>
          {s.lastUsedAt && <p className="muted">Last marked used on {s.lastUsedAt}.</p>}
          {s.notes && <p className="note-text"><b>Your note:</b> {s.notes}</p>}
          <p>Still worth it?</p>
          <div className="row-actions">
            <button className="btn" onClick={() => decide('skip')}>Skip</button>
            <button className="btn" onClick={() => decide('cancel')}>Cancel?</button>
            <button className="btn primary" onClick={() => decide('keep')}>Keep</button>
          </div>
        </>
      )}
    </Modal>
  );
}
