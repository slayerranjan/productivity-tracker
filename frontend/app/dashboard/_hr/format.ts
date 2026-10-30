// ===========================================================================
// HR DASHBOARD HELPERS
//
// Every date here is a plain "YYYY-MM-DD" string, never a Date in the
// browser's timezone. The backend decides what "today" is for the company
// (see platformToday on the server), and the dashboard simply does arithmetic
// on that string in UTC, so a laptop set to another timezone cannot shift a
// day. That is the same rule the backend follows.
// ===========================================================================

export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const parseDay = (s: string) => new Date(`${s}T00:00:00Z`);

export const addDays = (s: string, n: number) =>
  ymd(new Date(parseDay(s).getTime() + n * 86_400_000));

export const monthStart = (s: string) => `${s.slice(0, 8)}01`;

export function monthEnd(s: string) {
  const d = parseDay(s);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function previousMonth(s: string) {
  const d = parseDay(s);
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return { from: ymd(first), to: monthEnd(ymd(first)) };
}

export const daysBetween = (from: string, to: string) =>
  Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000) + 1;

export function fmtDay(s: string) {
  return parseDay(s).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export const rangeLabel = (from: string, to: string) =>
  from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`;

// Monday-first week containing the given day.
export function weekOf(s: string) {
  const dow = (parseDay(s).getUTCDay() + 6) % 7; // Mon = 0
  const monday = addDays(s, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function weekdayShort(s: string) {
  return parseDay(s).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
}

export function hm(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export const pct = (ratio: number) => `${Math.round((ratio || 0) * 100)}%`;

export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// Bucket keys come back as "2026-10-28" (day) or "2026-W42" (week).
export function bucketLabel(key: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? fmtDay(key) : key.replace(/^\d{4}-/, "");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
