// ---------------------------------------------------------------------------
// TIMEZONE RULE (frontend half)
// Every date and time on screen is read in the PLATFORM's timezone, never the
// browser's. The dashboard layout calls setPlatformTimezone() as soon as /me
// arrives, before any page renders. Calendar days travel as "YYYY-MM-DD"
// strings and are shifted with UTC arithmetic, so a browser in another zone
// (or a clock between midnight and 05:30 IST) cannot move a day.
// ---------------------------------------------------------------------------
let platformTz = "Asia/Kolkata";

export function setPlatformTimezone(tz: string | undefined | null) {
  if (tz) platformTz = tz;
}

export function getPlatformTimezone() {
  return platformTz;
}

function parts(date: Date, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: platformTz, ...opts }).formatToParts(date);
}

// Today's calendar day in the platform timezone, as YYYY-MM-DD.
export function todayIso(now: Date = new Date()): string {
  const p = parts(now, { year: "numeric", month: "2-digit", day: "2-digit" });
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Shift a YYYY-MM-DD day by n days (negative = earlier).
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function isoDaysAgo(n: number): string {
  return addDaysIso(todayIso(), -n);
}

export function firstOfMonthIso(): string {
  return `${todayIso().slice(0, 8)}01`;
}

// Hour of day (0-23) right now in the platform timezone.
export function currentHour(now: Date = new Date()): number {
  const p = parts(now, { hour: "2-digit", hourCycle: "h23" });
  return Number(p.find((x) => x.type === "hour")!.value);
}

export function formatTime(value: string | number | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleTimeString("en-IN", {
    timeZone: platformTz,
    ...(opts ?? {}),
  });
}

export function formatDateTime(value: string | number | Date, opts: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString("en-IN", { timeZone: platformTz, ...opts });
}

// For a real moment in time (e.g. "now"), not a stored calendar day.
export function formatDate(value: string | number | Date, opts: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString("en-IN", { timeZone: platformTz, ...opts });
}

// A <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm") means wall-clock
// time in the PLATFORM zone. new Date(value) would read it in the browser's
// zone instead, so work out the platform's UTC offset at that moment and
// apply it.
export function platformLocalToIso(local: string): string {
  const [datePart, timePart = "00:00"] = local.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const p = parts(new Date(asUtc), {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const shown = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
  return new Date(asUtc - (shown - asUtc)).toISOString();
}
