// ---------------------------------------------------------------------------
// TIMEZONE RULE
// The calendar day is the PLATFORM's day, not the server's. Read the
// year/month/day as they appear in that timezone, then store UTC midnight.
// Using new Date() directly puts an 11pm IST clock-in on the previous day.
// ---------------------------------------------------------------------------
export function platformToday(timezone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

// ---------------------------------------------------------------------------
// STRICT DAY PARSER
// Accepts only YYYY-MM-DD and only real calendar days. Without the round-trip
// check, 2026-02-31 silently becomes 3 March and 31-12-2026 becomes a date in
// the year 31 — both would be written to the database as if valid.
// ---------------------------------------------------------------------------
export function parseIsoDay(value: unknown): Date {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("BAD_DATE");
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.toISOString().slice(0, 10) !== s) throw new Error("BAD_DATE");
  return date;
}

// ---------------------------------------------------------------------------
// The UTC instant at which the wall clock in `timezone` reads dateIso + "HH:MM".
// Used when a person types "9:30" for a given company day.
// ---------------------------------------------------------------------------
export function zonedToUtc(dateIso: string, hhmm: string, timezone: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - ms;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

// "2026-10-28" in the company's timezone for an instant.
export function localDayOf(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
