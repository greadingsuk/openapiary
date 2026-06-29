// Lightweight Chart.js wrapper for hive weight & battery trends.
// Registers only the controllers/scales we use to keep bundle small.

import { useMemo } from "react";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
    TimeScale,
    Filler,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { Line } from "react-chartjs-2";

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
    TimeScale,
    Filler
);

export interface WeightPoint {
    ts: number;
    weight_kg?: number | null;
    battery_v?: number | null;
    temp_c?: number | null;
}

interface Props {
    readings: WeightPoint[];
    /** "weight" | "battery" | "temp" - default "weight" */
    metric?: "weight" | "battery" | "temp";
    /** Pixel height of the chart area. Default 240. */
    height?: number;
}

const SERIES = {
    weight: { label: "Weight (kg)", line: "#b8780a", fill: "rgba(245, 169, 31, 0.18)" },
    battery: { label: "Battery (V)", line: "#5f9145", fill: "rgba(95, 145, 69, 0.15)" },
    temp: { label: "Temp (°C)", line: "#d2581f", fill: "rgba(210, 88, 31, 0.15)" },
} as const;

export default function WeightChart({ readings, metric = "weight", height = 240 }: Props) {
    const data = useMemo(() => {
        const points = readings.map((r) => ({
            x: r.ts,
            y: metric === "weight" ? (r.weight_kg ?? null)
                : metric === "battery" ? (r.battery_v ?? null)
                : (r.temp_c ?? null),
        }));
        const s = SERIES[metric];
        return {
            datasets: [
                {
                    label: s.label,
                    data: points,
                    borderColor: s.line,
                    backgroundColor: s.fill,
                    fill: true,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                },
            ],
        };
    }, [readings, metric]);

    const options = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            // Animate the draw on first paint only, not on every data refresh.
            animation: { duration: 600 as number },
            interaction: { mode: "nearest" as const, intersect: false },
            scales: {
                x: {
                    type: "time" as const,
                    time: { tooltipFormat: "PPpp", displayFormats: { hour: "MMM d HH:mm" } },
                    ticks: { color: "#6e6047", maxTicksLimit: 6 },
                    grid: { color: "rgba(26,20,16,0.10)" },
                },
                y: {
                    ticks: { color: "#6e6047" },
                    grid: { color: "rgba(26,20,16,0.10)" },
                },
            },
            plugins: {
                legend: { labels: { color: "#1a1410" } },
            },
        }),
        []
    );

    if (!readings.length) {
        return <div className="oa-muted text-sm py-6 text-center">No data in this range yet.</div>;
    }
    return (
        <div style={{ height }}>
            <Line data={data} options={options} />
        </div>
    );
}
