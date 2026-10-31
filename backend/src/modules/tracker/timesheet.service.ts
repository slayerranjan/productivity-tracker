// ===========================================================================
// MY TIMESHEET
//
// Read-only. For one person and one date range: the schedule they work to and,
// for each day, the actual clock-in / clock-out and every break and meeting
// interval, so the screen can draw a timeline.
//
// Nothing here is recalculated. Totals come from the columns the tracker
// already writes on every break/meeting/clock-out (recompute-on-write), and the
// "expected days / planned hours" come from the SAME function the Reports page
// uses (getTeamReport, narrowed to this one person), so the timesheet, the
// dashboard and the reports always agree.
//
// Late and overtime are never invented here. Late is the flag the tracker
// stored when the person clocked in (shift start + grace). Overtime is
// described as the existing rule: time on site beyond the configured work day,
// with the same alert threshold the scheduler uses. The screen applies it.
// ===========================================================================

import { prisma } from "../../lib/prisma.js";
import { parseIsoDay, platformToday } from "../../lib/dates.js";
import { getTeamReport } from "../reports/reports.service.js";
import { getContext } from "./tracker.service.js";
import { remarksBySession } from "./lateRemarks.js";

const MAX_DAYS = 93;
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function getTimesheet(userId: string, fromStr?: string, toStr?: string) {
  const ctx = await getContext(userId);
  const today = platformToday(ctx.timezone);

  const to = toStr ? parseIsoDay(toStr) : today;
  const from = fromStr ? parseIsoDay(fromStr) : new Date(to.getTime() - 6 * DAY_MS);
  if (to.getTime() < from.getTime()) throw new Error("BAD_RANGE");
  if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_DAYS) throw new Error("RANGE_TOO_LONG");

  // Batched reads, joined in memory.
  const [sessions, holidays, report, corrections] = await Promise.all([
    prisma.workSession.findMany({
      where: { userId, date: { gte: from, lte: to } },
      include: {
        team: { select: { id: true, name: true } },
        breaks: { orderBy: { startedAt: "asc" } },
        // Only meetings that actually ran: an unanswered or declined invite
        // was never work.
        meetings: { where: { approvalStatus: "APPROVED", startedAt: { not: null } }, orderBy: { startedAt: "asc" } },
      },
    }),
    prisma.holiday.findMany({ where: { platformId: ctx.platformId, date: { gte: from, lte: to } }, select: { date: true, name: true, dayType: true } }),
    getTeamReport(userId, iso(from), iso(to), "day", userId),
    // Days HR corrected: the latest applied correction per session, for the "Corrected" marker.
    prisma.attendanceCorrectionAudit.findMany({
      where: { userId, action: "APPLIED", createdAt: { gte: new Date(from.getTime() - 40 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      select: { workSessionId: true, createdAt: true, actedBy: { select: { firstName: true, lastName: true } } },
    }).catch((e) => {
      // The "Corrected by HR" marker is optional. If the corrections table is not there yet (migration not applied), the timesheet must still load.
      console.error("[timesheet] corrections marker unavailable:", String((e as Error).message).slice(-120));
      return [] as { workSessionId: string | null; createdAt: Date; actedBy: { firstName: string; lastName: string } }[];
    }),
  ]);
  const correctedBy = new Map<string, { at: Date; by: string }>();
  for (const c of corrections) {
    if (c.workSessionId && !correctedBy.has(c.workSessionId)) correctedBy.set(c.workSessionId, { at: c.createdAt, by: `${c.actedBy.firstName} ${c.actedBy.lastName}`.trim() });
  }

  const sessionByDay = new Map(sessions.map((s) => [iso(s.date), s]));
  const remarkOf = await remarksBySession(sessions.map((s) => s.id));
  const holidayByDay = new Map(holidays.map((h) => [iso(h.date), h]));
  // One entry per day, as the Reports page computes expected days and leave.
  type Bucket = { key: string; daysExpected: number; daysOnLeave: number };
  const bucketByDay = new Map((report.buckets as Bucket[]).map((b) => [b.key, b]));

  const team = ctx.user.teamMemberships[0]?.team ?? null;
  const overtimeAlertMinutes = team?.config?.overtimeAlertMinutes ?? 15;

  const days = [];
  for (let t = to.getTime(); t >= from.getTime(); t -= DAY_MS) {
    const key = iso(new Date(t));
    const s = sessionByDay.get(key) ?? null;
    const bucket = bucketByDay.get(key);
    const holiday = holidayByDay.get(key) ?? null;
    const expected = (bucket?.daysExpected ?? 0) > 0;
    const onLeave = (bucket?.daysOnLeave ?? 0) > 0;

    days.push({
      date: key,
      isFuture: t > today.getTime(),
      expected,
      onLeave,
      holiday: holiday ? { name: holiday.name, dayType: String(holiday.dayType) } : null,
      session: s
        ? {
            id: s.id,
            status: s.status,
            loginAt: s.loginAt,
            logoutAt: s.logoutAt,
            autoClosed: s.autoClosed,
            productiveSeconds: s.productiveSeconds,
            breakSeconds: s.breakSeconds,
            meetingSeconds: s.meetingSeconds,
            wasLateLogin: s.wasLateLogin,
            lateByMinutes: s.lateByMinutes,
            lateRemark: remarkOf.get(s.id) ?? null,
            shiftStartTime: s.shiftStartTime,
            correction: correctedBy.get(s.id) ?? null,
            project: s.team ? { id: s.team.id, name: s.team.name } : null,
            breaks: s.breaks.map((b) => ({
              id: b.id,
              breakType: String(b.breakType),
              startedAt: b.startedAt,
              endedAt: b.endedAt,
              durationSeconds: b.durationSeconds,
              autoClosed: b.autoClosed,
              reason: b.reason,
            })),
            meetings: s.meetings.map((m) => ({
              id: m.id,
              meetingType: String(m.meetingType),
              title: m.title,
              startedAt: m.startedAt,
              endedAt: m.endedAt,
            })),
          }
        : null,
    });
  }

  const productiveSeconds = sessions.reduce((n, s) => n + s.productiveSeconds, 0);
  const breakSeconds = sessions.reduce((n, s) => n + s.breakSeconds, 0);
  const meetingSeconds = sessions.reduce((n, s) => n + s.meetingSeconds, 0);

  const shift = ctx.shift;
  return {
    range: { from: iso(from), to: iso(to) },
    today: iso(today),
    timezone: ctx.timezone,
    schedule: {
      shift: shift
        ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, workingDays: shift.workingDays, spansMidnight: shift.spansMidnight }
        : null,
      dailyWorkHours: ctx.config.dailyWorkHours,
      productiveHours: ctx.config.productiveHours,
      breakBudgetMinutes: ctx.config.breakBudgetMinutes,
      lateLoginGraceMinutes: ctx.config.lateLoginGraceMinutes,
      overtimeAlertMinutes,
    },
    totals: {
      expectedDays: report.totals.daysExpected,
      onLeaveDays: report.totals.daysOnLeave,
      // The planned (target) time for the period, as the Reports page defines it:
      // productive hours for each scheduled working day.
      plannedSeconds: report.totals.targetSeconds,
      daysWorked: sessions.length,
      productiveSeconds,
      breakSeconds,
      meetingSeconds,
      // Productive + break: the whole time on site. Breaks are never added to
      // productive time, and meetings sit inside productive time.
      elapsedSeconds: productiveSeconds + breakSeconds,
      lateDays: sessions.filter((s) => s.wasLateLogin).length,
    },
    days,
  };
}
