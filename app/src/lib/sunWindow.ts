// Generic UK sunrise/sunset — no GPS. Uses a fixed representative location
// (central UK) so day/night power scheduling is nationally sensible and can be
// recomputed weekly. Returns local minute-of-day for sunrise (day start) and
// sunset (day end); outside that window the scale reports less often.

const UK_LAT = 54.5;   // central UK latitude
const UK_LON = -2.5;   // central UK longitude
const ZENITH = 90.833; // official sunrise/sunset zenith (deg)

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm = (x: number, max: number) => ((x % max) + max) % max;

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86400000);
}

// Sunrise-equation solution. Returns UTC hours (0-24), or null in polar day/night.
function calcUTC(rise: boolean, N: number, lat: number, lon: number): number | null {
  const lngHour = lon / 15;
  const t = N + ((rise ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L = M + 1.916 * Math.sin(rad(M)) + 0.020 * Math.sin(rad(2 * M)) + 282.634;
  L = norm(L, 360);
  let RA = deg(Math.atan(0.91764 * Math.tan(rad(L))));
  RA = norm(RA, 360);
  // Bring RA into the same quadrant as L.
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(rad(L));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(rad(ZENITH)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null;
  let H = rise ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH));
  H /= 15;
  const T = H + RA - 0.06571 * t - 6.622;
  return norm(T - lngHour, 24);
}

export interface DayWindow {
  startMin: number;   // local minute-of-day daytime begins (sunrise)
  endMin: number;     // local minute-of-day daytime ends   (sunset)
  sunrise: string;    // "HH:MM"
  sunset: string;     // "HH:MM"
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Generic-UK day window for the given date, in the phone's local time. */
export function ukDayWindow(date = new Date()): DayWindow {
  const N = dayOfYear(date);
  const riseUTC = calcUTC(true, N, UK_LAT, UK_LON);
  const setUTC = calcUTC(false, N, UK_LAT, UK_LON);
  const tzMin = -date.getTimezoneOffset(); // minutes east of UTC
  const toLocalMin = (utcH: number) => norm(Math.round(utcH * 60) + tzMin, 1440);
  const startMin = riseUTC != null ? toLocalMin(riseUTC) : 6 * 60;
  const endMin = setUTC != null ? toLocalMin(setUTC) : 22 * 60;
  return { startMin, endMin, sunrise: fmt(startMin), sunset: fmt(endMin) };
}
