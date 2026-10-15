// ===========================================================================
// REPORTS — aggregate work sessions over any date range.
//
// Reads the pre-computed totals on work_sessions. Never recalculates from
// breaks and meetings — that is recompute-on-write's job, done at the moment
// the break or meeting closes.
//
// A report is a snapshot of recorded fact. Time ticking on a session that is
// still open is NOT added; the response flags hasOpenSessions so the UI can
// say so. The Live Team page is the real-time view.
// ===========================================================================

import { prisma } from "../../lib/prisma.js";

export type GroupBy = "person" | "day" | "week" | "month" | "year";

// Same weights as Daily Tasks, so the task score in a report matches the
// score the employee saw on the day.
const WEIGHT_VALUES: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 5,
};

// People who never had a tracker day. Compared as plain strings so an unknown
// status is simply never excluded, instead of failing to compile.
const EXCLUDED_STATUSES = new Set(["CANDIDATE", "OFFER_SENT", "OFFER_ACCEPTED"]);

// Fallbacks used only if no team config exists yet.
const DEFAULT_PRODUCTIVE_HOURS = 8;
const DEFAULT_BREAK_BUDGET_MINUTES = 60;

// --- date helpers ----------------------------------------------------------
// @db.Date columns come back as UTC midnight, so slicing the ISO string is
// the correct way to get the calendar day. Never use getDate() here — that
// applies the server's local offset and can shift the day by one.

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDay(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) throw new Error("BAD_DATE");
  return new Date(Date.UTC(y, m - 1, d));
}

// ISO week: weeks start Monday, and the week belongs to whichever year holds
// its Thursday. This is why "2026-W01" can contain days from 2025.
function isoWeekKey(date: Date): string {
  const t = new Date(date.getTime());
  const dayOfWeek = t.getUTCDay() || 7; // Sunday 0 -> 7
  t.setUTCDate(t.getUTCDate() + 4 - dayOfWeek); // jump to this week's Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function bucketKey(date: Date, groupBy: GroupBy): string {
  const iso = toKey(date);
  if (groupBy === "day") return iso;
  if (groupBy === "week") return isoWeekKey(date);
  if (groupBy === "month") return iso.slice(0, 7);
  if (groupBy === "year") return iso.slice(0, 4);
  return iso;
}

// --- who is the viewer allowed to see? -------------------------------------
// Scope comes from the JWT's userId and the role on their own row. It is
// never taken from the request, so adding ?userId= to the URL changes
// nothing — that is the IDOR guard.

async function resolveScope(viewerId: string) {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: {
      id: true,
      role: true,
      platformId: true,
      platform: { select: { name: true, timezone: true } },
    },
  });

  if (!viewer) throw new Error("NOT_FOUND");

  let userIds: string[];

  if (viewer.role === "EMPLOYEE") {
    userIds = [viewer.id];
  } else if (viewer.role === "MANAGER") {
    const myTeams = await prisma.teamMember.findMany({
      where: { userId: viewer.id, isActive: true },
      select: { teamId: true },
    });

    const peers = await prisma.teamMember.findMany({
      where: { teamId: { in: myTeams.map((t) => t.teamId) }, isActive: true },
      select: { userId: true },
    });

    // Set, because a manager in two teams would otherwise see shared
    // members twice — the same duplicate-row class of bug as React keys.
    userIds = Array.from(new Set([viewer.id, ...peers.map((p) => p.userId)]));
  } else {
    // HR and ADMIN see the whole platform.
    const everyone = await prisma.user.findMany({
      where: { platformId: viewer.platformId },
      select: { id: true, status: true },
    });
    userIds = everyone
      .filter((u) => !EXCLUDED_STATUSES.has(String(u.status)))
      .map((u) => u.id);
  }

  return { viewer, userIds };
}

// --- the report -------------------------------------------------------------

export async function getTeamReport(
  viewerId: string,
  fromStr: string,
  toStr: string,
  groupBy: GroupBy = "person"
) {
  const from = parseDay(fromStr);
  const to = parseDay(toStr);
  if (to.getTime() < from.getTime()) throw new Error("BAD_RANGE");

  const { viewer, userIds } = await resolveScope(viewerId);

  if (userIds.length === 0) {
    return {
      range: { from: fromStr, to: toStr },
      groupBy,
      target: { productiveHours: DEFAULT_PRODUCTIVE_HOURS, breakBudgetMinutes: DEFAULT_BREAK_BUDGET_MINUTES },
      totals: emptyTotals(),
      people: [],
      buckets: [],
      alertBreakdown: [],
      hasOpenSessions: false,
    };
  }

  const dateFilter = { gte: from, lte: to };

  // Five reads, one round trip of latency. Not five sequential awaits.
  const [users, sessions, leaveDays, tasks, alerts, config] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        employeeCode: true,
        role: true,
        designation: true,
      },
      orderBy: [{ firstName: "asc" }],
    }),

    prisma.workSession.findMany({
      where: { userId: { in: userIds }, date: dateFilter },
      select: {
        userId: true,
        date: true,
        status: true,
        logoutAt: true,
        productiveSeconds: true,
        breakSeconds: true,
        meetingSeconds: true,
        wasLateLogin: true,
        lateByMinutes: true,
        autoClosed: true,
      },
    }),

    prisma.leaveDay.findMany({
      where: { userId: { in: userIds }, date: dateFilter },
      select: { userId: true, date: true, isHalfDay: true },
    }),

    prisma.dailyTask.findMany({
      where: { userId: { in: userIds }, date: dateFilter },
      select: { userId: true, date: true, weight: true, status: true },
    }),

    prisma.alert.findMany({
      where: { userId: { in: userIds }, date: dateFilter },
      select: { userId: true, date: true, alertType: true, severity: true },
    }),

    prisma.teamConfig.findFirst({
      where: { team: { platformId: viewer.platformId } },
      select: { productiveHours: true, breakBudgetMinutes: true },
    }),
  ]);

  const productiveHours = config?.productiveHours ?? DEFAULT_PRODUCTIVE_HOURS;
  const breakBudgetMinutes = config?.breakBudgetMinutes ?? DEFAULT_BREAK_BUDGET_MINUTES;
  const dailyTargetSeconds = Math.round(Number(productiveHours) * 3600);

  // --- per-person accumulator ----------------------------------------------
  const byPerson = new Map<string, PersonRow>();
  for (const u of users) {
    byPerson.set(u.id, {
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      employeeCode: u.employeeCode,
      role: String(u.role),
      designation: u.designation ?? null,
      daysPresent: 0,
      daysOnLeave: 0,
      lateDays: 0,
      lateMinutes: 0,
      autoClosedDays: 0,
      productiveSeconds: 0,
      breakSeconds: 0,
      meetingSeconds: 0,
      targetSeconds: 0,
      attainment: 0,
      taskScore: 0,
      tasksTotal: 0,
      tasksDone: 0,
      alertCount: 0,
    });
  }

  const byBucket = new Map<string, BucketRow>();
  function bucket(key: string): BucketRow {
    let row = byBucket.get(key);
    if (!row) {
      row = {
        key,
        daysPresent: 0,
        peopleSeen: new Set<string>(),
        headcount: 0,
        daysOnLeave: 0,
        lateDays: 0,
        productiveSeconds: 0,
        breakSeconds: 0,
        meetingSeconds: 0,
        targetSeconds: 0,
        attainment: 0,
        alertCount: 0,
      };
      byBucket.set(key, row);
    }
    return row;
  }

  let hasOpenSessions = false;

  // --- sessions -------------------------------------------------------------
  for (const s of sessions) {
    if (String(s.status) === "ACTIVE" && !s.logoutAt) hasOpenSessions = true;

    const person = byPerson.get(s.userId);
    const b = bucket(bucketKey(s.date, groupBy));

    const add = (row: { daysPresent: number; lateDays: number; productiveSeconds: number; breakSeconds: number; meetingSeconds: number; targetSeconds: number }) => {
      row.daysPresent += 1;
      row.productiveSeconds += s.productiveSeconds;
      row.breakSeconds += s.breakSeconds;
      row.meetingSeconds += s.meetingSeconds;
      row.targetSeconds += dailyTargetSeconds;
      if (s.wasLateLogin) row.lateDays += 1;
    };

    if (person) {
      add(person);
      person.lateMinutes += s.lateByMinutes;
      if (s.autoClosed) person.autoClosedDays += 1;
    }

    add(b);
    b.peopleSeen.add(s.userId);
  }

  // --- leave ---------------------------------------------------------------
  // A leave day is not an absence. It adds no target, so it cannot drag
  // attainment down — it is simply excluded from the denominator.
  for (const l of leaveDays) {
    const weight = l.isHalfDay ? 0.5 : 1;
    const person = byPerson.get(l.userId);
    if (person) person.daysOnLeave += weight;
    bucket(bucketKey(l.date, groupBy)).daysOnLeave += weight;
  }

  // --- tasks ---------------------------------------------------------------
  for (const t of tasks) {
    const person = byPerson.get(t.userId);
    if (!person) continue;
    const weight = WEIGHT_VALUES[String(t.weight)] ?? 1;
    person.tasksTotal += weight;
    if (String(t.status) === "DONE") person.tasksDone += weight;
  }

  // --- alerts --------------------------------------------------------------
  const alertCounts = new Map<string, number>();
  for (const a of alerts) {
    const person = byPerson.get(a.userId);
    if (person) person.alertCount += 1;
    bucket(bucketKey(a.date, groupBy)).alertCount += 1;
    const key = String(a.alertType);
    alertCounts.set(key, (alertCounts.get(key) ?? 0) + 1);
  }

  // --- derived percentages -------------------------------------------------
  for (const person of byPerson.values()) {
    person.attainment = person.targetSeconds > 0
      ? person.productiveSeconds / person.targetSeconds
      : 0;
    person.taskScore = person.tasksTotal > 0
      ? person.tasksDone / person.tasksTotal
      : 0;
  }

  const buckets = Array.from(byBucket.values())
    .map((b) => ({
      key: b.key,
      headcount: b.peopleSeen.size,
      daysPresent: b.daysPresent,
      daysOnLeave: b.daysOnLeave,
      lateDays: b.lateDays,
      productiveSeconds: b.productiveSeconds,
      breakSeconds: b.breakSeconds,
      meetingSeconds: b.meetingSeconds,
      targetSeconds: b.targetSeconds,
      attainment: b.targetSeconds > 0 ? b.productiveSeconds / b.targetSeconds : 0,
      alertCount: b.alertCount,
    }))
    .sort((a, z) => a.key.localeCompare(z.key));

  const people = Array.from(byPerson.values()).sort(
    (a, z) => z.attainment - a.attainment
  );

  // --- totals --------------------------------------------------------------
  const totals = emptyTotals();
  for (const p of people) {
    totals.daysPresent += p.daysPresent;
    totals.daysOnLeave += p.daysOnLeave;
    totals.lateDays += p.lateDays;
    totals.productiveSeconds += p.productiveSeconds;
    totals.breakSeconds += p.breakSeconds;
    totals.meetingSeconds += p.meetingSeconds;
    totals.targetSeconds += p.targetSeconds;
    totals.alertCount += p.alertCount;
    totals.tasksTotal += p.tasksTotal;
    totals.tasksDone += p.tasksDone;
  }
  totals.headcount = people.filter((p) => p.daysPresent > 0).length;
  totals.attainment = totals.targetSeconds > 0
    ? totals.productiveSeconds / totals.targetSeconds
    : 0;
  totals.taskScore = totals.tasksTotal > 0
    ? totals.tasksDone / totals.tasksTotal
    : 0;

  return {
    range: { from: fromStr, to: toStr },
    groupBy,
    platform: viewer.platform?.name ?? null,
    scope:
      viewer.role === "EMPLOYEE" ? "self"
      : viewer.role === "MANAGER" ? "team"
      : "platform",
    target: { productiveHours: Number(productiveHours), breakBudgetMinutes },
    totals,
    people,
    buckets: groupBy === "person" ? [] : buckets,
    alertBreakdown: Array.from(alertCounts.entries())
      .map(([alertType, count]) => ({ alertType, count }))
      .sort((a, z) => z.count - a.count),
    hasOpenSessions,
  };
}

// --- types ------------------------------------------------------------------

type PersonRow = {
  userId: string;
  name: string;
  email: string;
  employeeCode: string | null;
  role: string;
  designation: string | null;
  daysPresent: number;
  daysOnLeave: number;
  lateDays: number;
  lateMinutes: number;
  autoClosedDays: number;
  productiveSeconds: number;
  breakSeconds: number;
  meetingSeconds: number;
  targetSeconds: number;
  attainment: number;
  taskScore: number;
  tasksTotal: number;
  tasksDone: number;
  alertCount: number;
};

type BucketRow = {
  key: string;
  daysPresent: number;
  peopleSeen: Set<string>;
  headcount: number;
  daysOnLeave: number;
  lateDays: number;
  productiveSeconds: number;
  breakSeconds: number;
  meetingSeconds: number;
  targetSeconds: number;
  attainment: number;
  alertCount: number;
};

function emptyTotals() {
  return {
    headcount: 0,
    daysPresent: 0,
    daysOnLeave: 0,
    lateDays: 0,
    productiveSeconds: 0,
    breakSeconds: 0,
    meetingSeconds: 0,
    targetSeconds: 0,
    attainment: 0,
    taskScore: 0,
    tasksTotal: 0,
    tasksDone: 0,
    alertCount: 0,
  };
}