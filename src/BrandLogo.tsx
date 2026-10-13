import { brandFor, initialOf, prefersLightInk } from './brands';

/** Rounded logo tile: the real mark when one is bundled, otherwise a brand-coloured monogram. */
export default function BrandLogo({ name, size = 44 }: { name: string; size?: number }) {
  const b = brandFor(name);
  const ink = prefersLightInk(b.hex) ? '#fff' : '#0b0b0b';
  return (
    <span className="logo" role="img" aria-label={`${b.label} logo`} style={{ width: size, height: size, background: `#${b.hex}`, color: ink, fontSize: size * 0.46 }}>
      {b.path
        ? <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="currentColor" aria-hidden="true"><path d={b.path} /></svg>
        : <b aria-hidden="true">{initialOf(b.label)}</b>}
    </span>
  );
}
