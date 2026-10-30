// Date-range presets shared by the attendance and productivity views. Calendar days only (YYYY-MM-DD), no browser timezone.

export type Preset = "today" | "yesterday" | "daybefore" | "last5" | "last7" | "last30" | "thisweek" | "lastweek" | "thismonth" | "lastmonth" | "single" | "custom";
export const PRESETS: [Preset, string][] = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["daybefore", "Day before yesterday"], ["last5", "Last 5 days"], ["last7", "Last 7 days"], ["last30", "Last 30 days"],
  ["thisweek", "This week"], ["lastweek", "Last week"], ["thismonth", "This month"], ["lastmonth", "Last month"], ["single", "Single date"], ["custom", "Custom range"],
];

// --- calendar-day arithmetic on "YYYY-MM-DD" strings (no browser timezone involved) -------------
const toDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
const mondayOf = (iso: string) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7));

export function rangeFor(p: Preset, today: string): { from: string; to: string } | null {
  const first = (y: number, m: number) => toIso(new Date(Date.UTC(y, m, 1)));
  const t = toDate(today);
  switch (p) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) };
    case "daybefore": return { from: addDays(today, -2), to: addDays(today, -2) };
    case "last5": return { from: addDays(today, -4), to: today };
    case "last7": return { from: addDays(today, -6), to: today };
    case "last30": return { from: addDays(today, -29), to: today };
    case "thisweek": return { from: mondayOf(today), to: today };
    case "lastweek": { const mon = addDays(mondayOf(today), -7); return { from: mon, to: addDays(mon, 6) }; }
    case "thismonth": return { from: first(t.getUTCFullYear(), t.getUTCMonth()), to: today };
    case "lastmonth": return { from: first(t.getUTCFullYear(), t.getUTCMonth() - 1), to: addDays(first(t.getUTCFullYear(), t.getUTCMonth()), -1) };
    default: return null; // single / custom come from the date inputs
  }
}

