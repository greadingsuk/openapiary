// Hive weight dial: a 7-cell honeycomb gauge. The ring fills with capacity
// (0–100%), the centre cell shows the live weight as a big tabular numeral.
// Animates the fill on mount/update and glows when the reading is live.
// Pure SVG, themable via the honey-* tokens.

import { useEffect, useRef, useState } from 'react';

interface Props {
    weightKg: number | null;
    batteryV: number | null;
    /** Empty hive weight in kg (default 18 for a typical National). */
    emptyKg?: number;
    /** Full hive target in kg (default 60 = honey-filled). */
    fullKg?: number;
    name?: string;
    /** Show the live glow + "live" affordance when the data is fresh. */
    live?: boolean;
}

const HEX_RADIUS = 36;
const HEX_GAP = 4;

function hexPoints(cx: number, cy: number, r: number): string {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
    }
    return pts.join(" ");
}

/** Returns the centres of a 7-cell honeycomb (1 centre + 6 ring). */
function combCenters(cx: number, cy: number): Array<[number, number]> {
    const r = HEX_RADIUS + HEX_GAP;
    const dx = r * Math.sqrt(3);
    const dy = r * 1.5;
    return [
        [cx, cy],
        [cx, cy - 2 * dy + r * 0.5],
        [cx + dx, cy - dy + r * 0.25],
        [cx + dx, cy + dy - r * 0.25],
        [cx, cy + 2 * dy - r * 0.5],
        [cx - dx, cy + dy - r * 0.25],
        [cx - dx, cy - dy + r * 0.25],
    ];
}

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function HiveVisual({
    weightKg,
    batteryV,
    emptyKg = 18,
    fullKg = 60,
    name,
    live = false,
}: Props) {
    const target = weightKg ?? 0;
    const filledFraction = Math.max(0, Math.min(1, (target - emptyKg) / (fullKg - emptyKg)));
    const ringFilled = Math.round(filledFraction * 6);

    // Count-up animation for the centre numeral.
    const [displayKg, setDisplayKg] = useState<number>(weightKg == null ? 0 : target);
    const rafRef = useRef<number | null>(null);
    const fromRef = useRef<number>(weightKg == null ? 0 : target);

    useEffect(() => {
        if (weightKg == null) { setDisplayKg(0); fromRef.current = 0; return; }
        if (prefersReducedMotion()) { setDisplayKg(target); fromRef.current = target; return; }
        const from = fromRef.current;
        const to = target;
        const start = performance.now();
        const dur = 800;
        const tick = (t: number) => {
            const p = Math.min(1, (t - start) / dur);
            const eased = 1 - Math.pow(1 - p, 3); // decelerate
            const v = from + (to - from) * eased;
            setDisplayKg(v);
            if (p < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                fromRef.current = to;
            }
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [target, weightKg]);

    const centres = combCenters(120, 130);
    const ring = centres.slice(1);
    const a11y = weightKg != null
        ? `Hive ${name ?? ''} weight ${weightKg.toFixed(2)} kilograms, ${Math.round(filledFraction * 100)} percent full${live ? ', live' : ''}`
        : `Hive ${name ?? ''}, no recent reading`;

    return (
        <div className="flex flex-col items-center gap-2 py-4">
            <svg
                viewBox="0 0 240 260"
                width="240"
                height="260"
                role="img"
                aria-label={a11y}
                className={live ? 'oa-glow' : undefined}
            >
                {/* Ring cells */}
                {ring.map(([cx, cy], i) => (
                    <polygon
                        key={i}
                        points={hexPoints(cx, cy, HEX_RADIUS)}
                        fill={i < ringFilled ? "var(--oa-honey-300)" : "var(--oa-honey-700)"}
                        stroke="var(--oa-honey-500)"
                        strokeWidth={1.5}
                        style={{
                            opacity: i < ringFilled ? 0.9 : 0.3,
                            transition: prefersReducedMotion() ? undefined : `opacity 400ms ease ${i * 70}ms`,
                        }}
                    />
                ))}
                {/* Centre cell shows weight */}
                <polygon
                    points={hexPoints(centres[0][0], centres[0][1], HEX_RADIUS)}
                    fill="var(--oa-honey-400)"
                    stroke="var(--oa-honey-200)"
                    strokeWidth={2}
                />
                <text
                    x={centres[0][0]}
                    y={centres[0][1] - 2}
                    textAnchor="middle"
                    fontSize="20"
                    fontWeight="700"
                    fill="var(--oa-on-accent)"
                    style={{ fontFamily: 'var(--oa-font-display)', fontVariantNumeric: 'tabular-nums' }}
                >
                    {weightKg != null ? displayKg.toFixed(2) : "--"}
                </text>
                <text
                    x={centres[0][0]}
                    y={centres[0][1] + 16}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--oa-on-accent)"
                >
                    kg
                </text>
            </svg>
            <div className="flex gap-4 text-sm oa-muted">
                <span>Fill: {Math.round(filledFraction * 100)}%</span>
                <span>Battery: {batteryV != null ? `${batteryV.toFixed(2)} V` : "--"}</span>
            </div>
            {name && <div className="text-xs oa-subtle">{name}</div>}
        </div>
    );
}
