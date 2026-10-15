import { brandFor, initialOf, prefersLightInk } from './brands';

/**
 * Rounded logo tile: the real mark when one is bundled, otherwise a brand-coloured monogram.
 * Decorative: the service name is always written next to it, so screen readers skip it.
 */
export default function BrandLogo({ name, size = 44 }: { name: string; size?: number }) {
  const b = brandFor(name);
  const ink = prefersLightInk(b.hex) ? '#fff' : '#0b0b0b';
  return (
    <span className="logo" aria-hidden="true" style={{ width: size, height: size, background: `#${b.hex}`, color: ink, fontSize: size * 0.46 }}>
      {b.path
        ? <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="currentColor" focusable="false"><path d={b.path} /></svg>
        : <b>{initialOf(b.label)}</b>}
    </span>
  );
}
