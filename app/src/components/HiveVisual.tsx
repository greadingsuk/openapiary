// Hex-comb visual: a 7-cell honeycomb where the centre cell shows the latest
// weight and the surrounding cells light up based on capacity (0-100%).
// Pure SVG, no external deps, themable via the Tailwind honey-* tokens.

interface Props {
    weightKg: number | null;
    batteryV: number | null;
    /** Empty hive weight in kg (default 18 for a typical National). */
    emptyKg?: number;
    /** Full hive target in kg (default 60 = honey-filled). */
    fullKg?: number;
    name?: string;
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

export default function HiveVisual({
    weightKg,
    batteryV,
    emptyKg = 18,
    fullKg = 60,
    name,
}: Props) {
    const w = weightKg ?? 0;
    const filledFraction = Math.max(0, Math.min(1, (w - emptyKg) / (fullKg - emptyKg)));
    const ringFilled = Math.round(filledFraction * 6);

    const centres = combCenters(120, 130);
    const ring = centres.slice(1);

    return (
        <div className="flex flex-col items-center gap-2 py-4 text-honey-100">
            <svg viewBox="0 0 240 260" width="240" height="260" role="img" aria-label={`Hive ${name ?? ""} visual`}>
                {/* Ring cells */}
                {ring.map(([cx, cy], i) => (
                    <polygon
                        key={i}
                        points={hexPoints(cx, cy, HEX_RADIUS)}
                        fill={i < ringFilled ? "var(--color-honey-300)" : "var(--color-honey-700)"}
                        opacity={i < ringFilled ? 0.9 : 0.35}
                        stroke="var(--color-honey-500)"
                        strokeWidth={1.5}
                    />
                ))}
                {/* Centre cell shows weight */}
                <polygon
                    points={hexPoints(centres[0][0], centres[0][1], HEX_RADIUS)}
                    fill="var(--color-honey-400)"
                    stroke="var(--color-honey-200)"
                    strokeWidth={2}
                />
                <text
                    x={centres[0][0]}
                    y={centres[0][1] - 2}
                    textAnchor="middle"
                    fontSize="20"
                    fontWeight="700"
                    fill="var(--color-comb-bg)"
                >
                    {weightKg != null ? weightKg.toFixed(1) : "--"}
                </text>
                <text
                    x={centres[0][0]}
                    y={centres[0][1] + 16}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--color-comb-bg)"
                >
                    kg
                </text>
            </svg>
            <div className="flex gap-4 text-sm">
                <span className="opacity-70">Fill: {Math.round(filledFraction * 100)}%</span>
                <span className="opacity-70">
                    Battery: {batteryV != null ? `${batteryV.toFixed(2)} V` : "--"}
                </span>
            </div>
            {name && <div className="text-xs opacity-60">{name}</div>}
        </div>
    );
}
