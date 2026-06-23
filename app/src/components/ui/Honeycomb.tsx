// Reusable honeycomb glyph — the brand's empty-state / loading motif.
// Pure SVG so it themes via tokens and scales crisply.

interface Props {
  size?: number;
  /** Fraction 0..1 of cells lit (for loading vs decorative). */
  fillFraction?: number;
  className?: string;
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(' ');
}

export default function Honeycomb({ size = 96, fillFraction = 0, className }: Props) {
  const r = 18;
  const gap = 3;
  const step = r + gap;
  const dx = step * Math.sqrt(3);
  const dy = step * 1.5;
  const cx = size / 2;
  const cy = size / 2;
  const centres: Array<[number, number]> = [
    [cx, cy],
    [cx, cy - 2 * dy + step * 0.5],
    [cx + dx, cy - dy + step * 0.25],
    [cx + dx, cy + dy - step * 0.25],
    [cx, cy + 2 * dy - step * 0.5],
    [cx - dx, cy + dy - step * 0.25],
    [cx - dx, cy - dy + step * 0.25],
  ];
  const lit = Math.round(fillFraction * centres.length);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden="true">
      {centres.map(([x, y], i) => (
        <polygon
          key={i}
          points={hexPoints(x, y, r)}
          fill={i < lit ? 'var(--oa-honey-300)' : 'var(--oa-honey-700)'}
          opacity={i < lit ? 0.9 : 0.22}
          stroke="var(--oa-honey-500)"
          strokeWidth={1.25}
        />
      ))}
    </svg>
  );
}
