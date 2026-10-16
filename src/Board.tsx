import { useEffect, useMemo, useRef } from 'react';
import { CYCLE_SHORT, type Subscription } from './types';
import type { CancelState } from './zombie';
import BrandLogo from './BrandLogo';

interface Props {
  subs: Subscription[];
  monthly: number;
  saved: { verified: number; pending: number };
  stateOf: (s: Subscription) => CancelState;
  costOf: (s: Subscription) => number; // monthly cost in the base currency
  money: (n: number, currency?: string) => string;
  daysUntil: (d: string) => number;
  onOpen: (s: Subscription) => void;
  onScan: () => void;
}

const GOLDEN = 2.399963;
const seeded = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

/** Drag-to-explore canvas: every subscription is a tilted card, bigger when it costs more. */
const BADGE: Partial<Record<CancelState, string>> = { cancelling: 'Cancelling', awaiting: 'Unverified', verified: 'Cancelled ✓', zombie: 'Still charging!' };

export default function Board({ subs, monthly, saved, stateOf, costOf, money, daysUntil, onOpen, onScan }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const pan = useRef({ x: 0, y: 0 });
  const dragged = useRef(false);
  const raf = useRef(0);

  const layout = useMemo(() => {
    const sorted = [...subs].sort((a, b) => costOf(b) - costOf(a));
    const top = Math.max(1, ...sorted.map(costOf));
    return sorted.map((s, i) => {
      const cost = costOf(s);
      const size = 132 + Math.round(Math.sqrt(cost / top) * 64);
      const r = 235 + 118 * Math.sqrt(i);
      const a = i * GOLDEN + 0.6;
      const key = s.id ?? i;
      return {
        s, size, i,
        x: Math.cos(a) * r * 1.3, y: Math.sin(a) * r * 0.95,
        tilt: (seeded(key) - 0.5) * 11,
      };
    });
  }, [subs, costOf]);

  const apply = () => { if (world.current) world.current.style.transform = `translate3d(${pan.current.x}px, ${pan.current.y}px, 0)`; };
  const reach = useMemo(() => Math.max(300, ...layout.map(l => Math.max(Math.abs(l.x), Math.abs(l.y) * 1.6))) + 120, [layout]);

  useEffect(() => { pan.current = { x: 0, y: 0 }; apply(); }, [subs.length === 0]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    dragged.current = false;
    let last = { x: e.clientX, y: e.clientY, t: performance.now() };
    let vel = { x: 0, y: 0 };
    const clamp = (v: number) => Math.max(-reach, Math.min(reach, v));
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last.x, dy = ev.clientY - last.y, now = performance.now();
      if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 6) dragged.current = true;
      pan.current = { x: clamp(pan.current.x + dx), y: clamp(pan.current.y + dy) };
      vel = { x: dx / Math.max(1, now - last.t) * 16, y: dy / Math.max(1, now - last.t) * 16 };
      last = { x: ev.clientX, y: ev.clientY, t: now };
      apply();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      stage.current?.classList.remove('grabbing');
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const glide = () => {
        vel = { x: vel.x * 0.93, y: vel.y * 0.93 };
        pan.current = { x: clamp(pan.current.x + vel.x), y: clamp(pan.current.y + vel.y) };
        apply();
        if (Math.abs(vel.x) + Math.abs(vel.y) > 0.4) raf.current = requestAnimationFrame(glide);
      };
      glide();
    };
    stage.current?.classList.add('grabbing');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = 90, k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k) || e.target !== e.currentTarget) return;
    e.preventDefault();
    pan.current = { x: pan.current.x + (k === 'ArrowLeft' ? step : k === 'ArrowRight' ? -step : 0), y: pan.current.y + (k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0) };
    apply();
  }

  const soon = subs.filter(s => stateOf(s) === 'active' && daysUntil(s.nextRenewal) >= 0 && daysUntil(s.nextRenewal) <= 7).length;
  const activeCount = subs.filter(s => stateOf(s) === 'active' && !s.isTrial).length;

  return (
    <div className="stage" ref={stage} onPointerDown={onPointerDown} onKeyDown={onKeyDown} tabIndex={0} role="group" aria-label="Subscription board. Drag, or use arrow keys, to explore.">
      <div className="world" ref={world}>
        <div className="hero-card">
          <span className="eyebrow">Per month</span>
          <strong className="big">{money(monthly)}</strong>
          <span className="sub">{money(monthly * 12)} a year · {activeCount} active{soon > 0 && ` · ${soon} renewing this week`}</span>
          {(saved.verified > 0 || saved.pending > 0) && <span className="saved">{saved.verified > 0 && <>Saved {money(saved.verified)}/yr ✓</>}{saved.verified > 0 && saved.pending > 0 && ' · '}{saved.pending > 0 && <>{money(saved.pending)}/yr pending</>}</span>}
          {subs.length === 0 && <button className="btn primary" onClick={onScan}>Scan a statement</button>}
        </div>
        {layout.map(({ s, size, x, y, tilt, i }) => (
          <button
            key={s.id}
            className={`tile st-${stateOf(s)}`}
            style={{ ['--x' as string]: `${x}px`, ['--y' as string]: `${y}px`, ['--tilt' as string]: `${tilt}deg`, ['--size' as string]: `${size}px`, ['--i' as string]: i }}
            onClick={() => { if (!dragged.current) onOpen(s); }}
            onFocus={e => { if (e.currentTarget.matches(':focus-visible')) { pan.current = { x: -x, y: -y }; apply(); } }}
          >
            {BADGE[stateOf(s)] && <span className={`badge st-${stateOf(s)}`}>{BADGE[stateOf(s)]}</span>}
            <BrandLogo name={s.name} size={Math.round(size * 0.42)} />
            <span className="t-name">{s.name}{s.isTrial && <em className="pill trial">trial</em>}</span>
            <span className="t-price">{money(s.amount, s.currency)}<small>/{CYCLE_SHORT[s.cycle]}</small></span>
            <span className="t-next">{stateOf(s) !== 'active' ? (s.cancelEffectiveDate ? `paid to ${s.cancelEffectiveDate}` : '') : daysUntil(s.nextRenewal) <= 0 ? 'renews today' : `in ${daysUntil(s.nextRenewal)}d`}</span>
          </button>
        ))}
      </div>
      <span className="drag-hint" aria-hidden="true">{subs.length ? 'Drag to explore' : 'Nothing here yet'}</span>
    </div>
  );
}
