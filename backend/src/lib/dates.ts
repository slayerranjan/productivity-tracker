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
