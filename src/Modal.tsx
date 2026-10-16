import { useId, useRef } from 'react';
import { useModalA11y } from './a11y';

/** Accessible dialog: moves focus in, traps Tab, closes on Escape or a click outside, and returns focus when closed. */
export default function Modal({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y(box, onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div ref={box} className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={e => e.stopPropagation()}>
        <div className="row"><h2 id={titleId}>{title}</h2><button className="link" onClick={onClose} aria-label="Close dialog">✕</button></div>
        {children}
      </div>
    </div>
  );
}
