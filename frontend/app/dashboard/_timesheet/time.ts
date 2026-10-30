// ===========================================================================
// TIME HELPERS for the timesheet
//
// Every clock time on this page is shown in the COMPANY's timezone (the one the
// server uses to decide what "today" is), never the browser's. Otherwise a
// laptop set to another timezone would draw the same shift at a different hour.
// Dates are plain "YYYY-MM-DD" strings and are only ever added to in UTC.
// ===========================================================================

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

export function tzParts(ms: number, tz: string) {
  const parts = dtf(tz, { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

// The UTC instant at which the wall clock in `tz` reads dateIso + "HH:MM".
export function zonedToMs(dateIso: string, hhmm: string, tz: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = (ms: number) => {
    const p = tzParts(ms, tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

export function floorHour(ms: number, tz: string) {
  const p = tzParts(ms, tz);
  return ms - (p.mi * 60 + p.s) * 1000 - (((ms % 1000) + 1000) % 1000);
}
export const ceilHour = (ms: number, tz: string) => {
  const f = floorHour(ms, tz);
  return f === ms ? ms : f + 3_600_000;
};

export const fmtClock = (ms: number, tz: string) =>
  dtf(tz, { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms));
export const fmtHour = (ms: number, tz: string) =>
  dtf(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));

export function fmtDateTime(ms: number, tz: string) {
  const d = dtf(tz, { month: "short", day: "numeric", year: "numeric" }).format(new Date(ms));
  return `${d}, ${fmtClock(ms, tz)}`;
}

export function fmtDur(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function hrsMins(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) };
}

export const hms = (total: number) => {
  const s = Math.max(0, Math.floor(total));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0"));
};

// --- plain date strings --------------------------------------------------------------
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => new Date(parse(s).getTime() + n * 86_400_000).toISOString().slice(0, 10);
export const monthStart = (s: string) => `${s.slice(0, 8)}01`;
export const spanDays = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
export const shortDay = (s: string) => parse(s).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
export const longDay = (s: string) => parse(s).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
export const weekdayName = (s: string) => parse(s).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

export type Preset = "TODAY" | "YESTERDAY" | "LAST_7" | "LAST_30" | "THIS_MONTH" | "CUSTOM";
export const PRESETS: { key: Preset; label: string }[] = [
  { key: "TODAY", label: "Today" },
  { key: "YESTERDAY", label: "Yesterday" },
  { key: "LAST_7", label: "Last 7 Days" },
  { key: "LAST_30", label: "Last 30 Days" },
  { key: "THIS_MONTH", label: "This Month" },
  { key: "CUSTOM", label: "Custom Range" },
];

export function presetRange(preset: Preset, today: string, custom: { from: string; to: string }) {
  switch (preset) {
    case "TODAY": return { from: today, to: today };
    case "YESTERDAY": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "LAST_7": return { from: addDays(today, -6), to: today };
    case "LAST_30": return { from: addDays(today, -29), to: today };
    case "THIS_MONTH": return { from: monthStart(today), to: today };
    default: return custom;
  }
}

export const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
