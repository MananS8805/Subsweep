import { CATEGORIES, CYCLES, CYCLE_LABEL, type Cycle } from './types';
import { selectedItems, type PreviewItem } from './importPreview';
import Modal from './Modal';
import BrandLogo from './BrandLogo';

interface Props {
  items: PreviewItem[];
  skipped: number;
  tracked: number;
  money: (n: number, currency?: string) => string;
  onChange: (items: PreviewItem[]) => void;
  onAdd: () => void;
  onCancel: () => void;
}

/**
 * Review step for a statement scan. Nothing here is saved: the rows live in memory until "Add N selected", and
 * closing the dialog throws them away. Every field is editable and labelled so it works with a keyboard and a screen reader.
 */
export default function ImportReview({ items, skipped, tracked, money, onChange, onAdd, onCancel }: Props) {
  const count = selectedItems(items).length;
  const found = items.length - tracked;
  const edit = (key: string, patch: Partial<PreviewItem>) => onChange(items.map(i => (i.key === key ? { ...i, ...patch } : i)));
  const facts = [
    `${found} recurring charge${found === 1 ? '' : 's'} found`,
    skipped ? `${skipped} row${skipped === 1 ? '' : 's'} skipped` : '',
    tracked ? `${tracked} already tracked` : '',
  ].filter(Boolean).join(' · ');

  return (
    <Modal wide onClose={onCancel} title="Review before adding">
      <p className="muted">{facts}. Nothing is saved until you add it. Low-confidence items start unticked.</p>
      <ul className="plain pv-list">
        {items.map(i => (
          <li key={i.key} className={`pv-row${i.alreadyTracked ? ' is-tracked' : ''}`}>
            <div className="pv-head">
              <input
                type="checkbox" id={`pv-${i.key}`} checked={i.checked && !i.alreadyTracked} disabled={i.alreadyTracked}
                onChange={e => edit(i.key, { checked: e.target.checked })} aria-label={`Add ${i.name}`}
              />
              <BrandLogo name={i.name} size={34} />
              <span className="pv-title">
                <b>{i.name}</b>{' '}
                {i.alreadyTracked
                  ? <span className="conf conf-tracked">Already tracked</span>
                  : <span className={`conf conf-${i.label}`} title={`Confidence ${Math.round(i.confidence * 100)}%`}>{i.label} confidence</span>}
                <small className="muted block">
                  {CYCLE_LABEL[i.cycle]} · seen {i.occurrences}× · last charge {i.lastDate}
                  {i.priceCreep && <span className="creep"> · price up {money(i.priceCreep.from, i.currency)} → {money(i.priceCreep.to, i.currency)}</span>}
                </small>
              </span>
            </div>
            <div className="pv-fields">
              <label>Name<input value={i.name} disabled={i.alreadyTracked} onChange={e => edit(i.key, { name: e.target.value })} /></label>
              <label>Amount ({i.currency})
                <input type="number" inputMode="decimal" min="0.01" step="0.01" value={Number.isFinite(i.amount) ? i.amount : ''} disabled={i.alreadyTracked}
                  onChange={e => edit(i.key, { amount: e.target.value === '' ? NaN : +e.target.value })} />
              </label>
              <label>Cycle
                <select value={i.cycle} disabled={i.alreadyTracked} onChange={e => edit(i.key, { cycle: e.target.value as Cycle })}>
                  {CYCLES.map(c => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
                </select>
              </label>
              <label>Category
                <select value={i.category} disabled={i.alreadyTracked} onChange={e => edit(i.key, { category: e.target.value })}>
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div className="row-actions pv-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={count === 0} onClick={onAdd}>Add {count} selected</button>
      </div>
    </Modal>
  );
}
