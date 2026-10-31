import { zonedToUtc } from "../../lib/dates.js";

// Pure rules for a manager's self-managed tasks (no database, so every boundary can be tested).

/** The deadline is the END of the due day in the company timezone: the first instant of the next day. */
export function dueEnd(dueDate: Date, timezone: string): Date {
  const next = new Date(dueDate.getTime() + 86_400_000).toISOString().slice(0, 10);
  return zonedToUtc(next, "00:00", timezone);
}

/** Overdue = the deadline day has fully passed and the task is neither completed nor cancelled. No deadline = never overdue. */
export function isOverdue(t: { dueDate: Date | null; status: string }, now: Date, timezone: string): boolean {
  if (!t.dueDate) return false;
  if (t.status === "COMPLETED" || t.status === "CANCELLED") return false;
  return now.getTime() >= dueEnd(t.dueDate, timezone).getTime();
}
