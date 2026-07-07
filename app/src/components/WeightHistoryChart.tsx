// Weight history chart with selectable views:
//   line        - raw weight over time (default)
//   gain        - daily net change (close-to-close) as up/down bars
//   candlestick - daily OHLC (foraging amplitude at a glance)
//   trend       - raw weight (faint) + trailing moving average (bold)
//
// Uses chart.js + the financial plugin for candlesticks. Only the controllers
// we use are registered to keep the bundle lean.

import { useMemo, useRef } from 'react';
import {
  Chart as ChartJS,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import 'chartjs-adapter-date-fns';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  CandlestickController,
  CandlestickElement,
  Tooltip,
  Legend,
  Filler,
);

export type WeightChartType = 'line' | 'gain' | 'candlestick' | 'trend';

export interface WeightPoint {
  ts: number;
  weight_kg?: number | null;
}

interface Props {
  readings: WeightPoint[];
  chartType: WeightChartType;
  height?: number;
}

const HONEY = '#b8780a';
const HONEY_FILL = 'rgba(245, 169, 31, 0.18)';
const UP = '#5f9145';
const DOWN = '#c0472b';
const INK_SUB = '#6e6047';
const GRID = 'rgba(26,20,16,0.10)';

interface DayOHLC { day: number; o: number; h: number; l: number; c: number; }

/** Group readings into per-local-day OHLC buckets (weight only). */
function toDaily(readings: WeightPoint[]): DayOHLC[] {
  const byDay = new Map<number, number[]>();
  for (const r of readings) {
    if (r.weight_kg == null) continue;
    const d = new Date(r.ts);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    const arr = byDay.get(key) ?? [];
    arr.push(r.weight_kg);
    byDay.set(key, arr);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, w]) => ({ day, o: w[0], h: Math.max(...w), l: Math.min(...w), c: w[w.length - 1] }));
}

/** Trailing moving average over `win` points. */
function movingAverage(points: { x: number; y: number }[], win: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let sum = 0;
  const q: number[] = [];
  for (const p of points) {
    q.push(p.y);
    sum += p.y;
    if (q.length > win) sum -= q.shift() as number;
    out.push({ x: p.x, y: sum / q.length });
  }
  return out;
}

export default function WeightHistoryChart({ readings, chartType, height = 240 }: Props) {
  const chartRef = useRef<ChartJS | null>(null);

  const { type, data } = useMemo(() => {
    const raw = readings
      .filter((r) => r.weight_kg != null)
      .map((r) => ({ x: r.ts, y: r.weight_kg as number }));

    if (chartType === 'candlestick') {
      const daily = toDaily(readings);
      return {
        type: 'candlestick' as const,
        data: {
          datasets: [{
            label: 'Daily weight (OHLC)',
            data: daily.map((d) => ({ x: d.day, o: d.o, h: d.h, l: d.l, c: d.c })),
            color: { up: UP, down: DOWN, unchanged: HONEY },
            borderColor: { up: UP, down: DOWN, unchanged: HONEY },
          }],
        },
      };
    }

    if (chartType === 'gain') {
      const daily = toDaily(readings);
      const bars = daily.map((d, idx) => ({
        x: d.day,
        y: idx === 0 ? +(d.c - d.o).toFixed(2) : +(d.c - daily[idx - 1].c).toFixed(2),
      }));
      return {
        type: 'bar' as const,
        data: {
          datasets: [{
            label: 'Daily gain (kg)',
            data: bars,
            backgroundColor: bars.map((b) => (b.y >= 0 ? UP : DOWN)),
            borderColor: bars.map((b) => (b.y >= 0 ? UP : DOWN)),
            borderWidth: 1,
          }],
        },
      };
    }

    if (chartType === 'trend') {
      const win = Math.max(5, Math.round(raw.length / 24));
      return {
        type: 'line' as const,
        data: {
          datasets: [
            {
              label: 'Weight (kg)',
              data: raw,
              borderColor: 'rgba(184,120,10,0.35)',
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.25,
              pointRadius: 0,
              borderWidth: 1,
            },
            {
              label: 'Trend (avg)',
              data: movingAverage(raw, win),
              borderColor: HONEY,
              backgroundColor: 'transparent',
              fill: false,
              tension: 0.35,
              pointRadius: 0,
              borderWidth: 2.5,
            },
          ],
        },
      };
    }

    // default: line
    return {
      type: 'line' as const,
      data: {
        datasets: [{
          label: 'Weight (kg)',
          data: raw,
          borderColor: HONEY,
          backgroundColor: HONEY_FILL,
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 4,
        }],
      },
    };
  }, [readings, chartType]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 500 as number },
    interaction: { mode: 'nearest' as const, intersect: false },
    scales: {
      x: {
        type: 'time' as const,
        time: {
          tooltipFormat: chartType === 'line' || chartType === 'trend' ? 'PPpp' : 'PP',
          displayFormats: { hour: 'MMM d HH:mm', day: 'MMM d' },
        },
        ticks: { color: INK_SUB, maxTicksLimit: 6 },
        grid: { color: GRID },
      },
      y: {
        ticks: { color: INK_SUB },
        grid: { color: GRID },
      },
    },
    plugins: {
      legend: { display: chartType === 'trend', labels: { color: '#1a1410' } },
    },
  }), [chartType]);

  if (!readings.some((r) => r.weight_kg != null)) {
    return <div className="oa-muted text-sm py-6 text-center">No data in this range yet.</div>;
  }

  const clearTooltip = () => {
    const ch = chartRef.current;
    if (!ch) return;
    ch.setActiveElements([]);
    ch.update('none');
  };

  return (
    <div style={{ height }} onTouchEnd={clearTooltip} onTouchCancel={clearTooltip} onMouseLeave={clearTooltip}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Chart ref={chartRef as any} type={type as any} data={data as any} options={options as any} />
    </div>
  );
}
