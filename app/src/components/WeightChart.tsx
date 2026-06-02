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
    weight_kg: number | null;
    battery_v?: number | null;
}

interface Props {
    readings: WeightPoint[];
    /** "weight" | "battery" - default "weight" */
    metric?: "weight" | "battery";
}

export default function WeightChart({ readings, metric = "weight" }: Props) {
    const data = useMemo(() => {
        const points = readings.map((r) => ({
            x: r.ts,
            y: metric === "weight" ? r.weight_kg : r.battery_v ?? null,
        }));
        return {
            datasets: [
                {
                    label: metric === "weight" ? "Weight (kg)" : "Battery (V)",
                    data: points,
                    borderColor:
                        metric === "weight" ? "rgb(245, 169, 31)" : "rgb(155, 205, 155)",
                    backgroundColor:
                        metric === "weight"
                            ? "rgba(255, 194, 51, 0.2)"
                            : "rgba(155, 205, 155, 0.15)",
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
            interaction: { mode: "nearest" as const, intersect: false },
            scales: {
                x: {
                    type: "time" as const,
                    time: { tooltipFormat: "PPpp", displayFormats: { hour: "MMM d HH:mm" } },
                    ticks: { color: "#fff3d1", maxTicksLimit: 6 },
                    grid: { color: "rgba(255,243,209,0.08)" },
                },
                y: {
                    ticks: { color: "#fff3d1" },
                    grid: { color: "rgba(255,243,209,0.08)" },
                },
            },
            plugins: {
                legend: { labels: { color: "#fff3d1" } },
            },
        }),
        []
    );

    if (!readings.length) {
        return <div className="text-honey-100 opacity-60 text-sm">No data yet.</div>;
    }
    return (
        <div style={{ height: 240 }}>
            <Line data={data} options={options} />
        </div>
    );
}
