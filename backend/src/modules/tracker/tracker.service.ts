import { prisma } from "../../lib/prisma.js";

const DEFAULTS = {
  dailyWorkHours: 9,
  productiveHours: 8,
  breakBudgetMinutes: 60,
  lateLoginGraceMinutes: 15,
};

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

export function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return get("hour") * 60 + get("minute");
}

// Everything the engine needs about one person: platform timezone, the
// team's targets, and the shift their day is measured against.
async function getContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      platform: true,
      shift: true,
      teamMemberships: {
        where: { isActive: true },
        include: { team: { include: { config: true, shift: true } } },
      },
    },
  });

  if (!user) throw new Error("USER_NOT_FOUND");
  if (!user.trackerAccessEnabled) throw new Error("TRACKER_LOCKED");

  const team = user.teamMemberships[0]?.team ?? null;
  const config = team?.config ?? null;
  const shift = team?.shift ?? user.shift ?? null;

  return {
    user,
    platformId: user.platformId,
    timezone: user.platform.timezone,
    shift,
    config: {
      dailyWorkHours: config?.dailyWorkHours ?? DEFAULTS.dailyWorkHours,
      productiveHours: config?.productiveHours ?? DEFAULTS.productiveHours,
      breakBudgetMinutes:
        config?.breakBudgetMinutes ?? DEFAULTS.breakBudgetMinutes,
      lateLoginGraceMinutes:
        config?.lateLoginGraceMinutes ?? DEFAULTS.lateLoginGraceMinutes,
    },
  };
}

// ---------------------------------------------------------------------------
// Recompute the three totals from the detail rows and WRITE them to the
// session. Called after every state change. Reports read these columns and
// never recalculate — which is why this must never be skipped.
// ---------------------------------------------------------------------------
export async function recompute(sessionId: string) {
  const session = await prisma.workSession.findUnique({
    where: { id: sessionId },
    include: { breaks: true, meetings: true },
  });
  if (!session) throw new Error("SESSION_NOT_FOUND");

  const now = new Date();
  const end = session.logoutAt ?? now;
  const elapsed = Math.max(
    0,
    Math.floor((end.getTime() - session.loginAt.getTime()) / 1000)
  );

  let breakSeconds = 0;
  for (const b of session.breaks) {
    const bEnd = b.endedAt ?? now;
    breakSeconds += Math.max(
      0,
      Math.floor((bEnd.getTime() - b.startedAt.getTime()) / 1000)
    );
  }

  let meetingSeconds = 0;
  for (const m of session.meetings) {
    // Unaccepted invite time is not counted at all.
    if (m.approvalStatus !== "APPROVED" || !m.startedAt) continue;
    const mEnd = m.endedAt ?? now;
    meetingSeconds += Math.max(
      0,
      Math.floor((mEnd.getTime() - m.startedAt.getTime()) / 1000)
    );
  }

  const productiveSeconds = Math.max(
    0,
    elapsed - breakSeconds - meetingSeconds
  );

  return prisma.workSession.update({
    where: { id: sessionId },
    data: { breakSeconds, meetingSeconds, productiveSeconds },
    include: { breaks: true, meetings: true },
  });
}

export async function getActiveSession(userId: string) {
  const ctx = await getContext(userId);
  const date = platformToday(ctx.timezone);

  const session = await prisma.workSession.findUnique({
    where: { userId_date: { userId, date } },
    include: { breaks: true, meetings: true },
  });

  if (!session) return { session: null, config: ctx.config };

  const fresh = await recompute(session.id);
  return { session: fresh, config: ctx.config };
}

export async function clockIn(userId: string) {
  const ctx = await getContext(userId);
  const date = platformToday(ctx.timezone);
  const now = new Date();

  const existing = await prisma.workSession.findUnique({
    where: { userId_date: { userId, date } },
    include: { breaks: true, meetings: true },
  });

  if (existing?.status === "ACTIVE") {
    return recompute(existing.id);
  }

  // SESSION RESUME: clocked out early, coming back. Reopen the same session
  // and log the time away as a break, rather than locking them out all day.
  if (existing?.status === "COMPLETED") {
    if (existing.productiveSeconds >= ctx.config.productiveHours * 3600) {
      throw new Error("ALREADY_COMPLETED");
    }

    if (existing.logoutAt) {
      const away = Math.floor(
        (now.getTime() - existing.logoutAt.getTime()) / 1000
      );
      if (away > 0) {
        await prisma.trackerBreak.create({
          data: {
            workSessionId: existing.id,
            breakType: "OTHER",
            startedAt: existing.logoutAt,
            endedAt: now,
            durationSeconds: away,
            reason: "Away between clock-out and clock-in",
          },
        });
      }
    }

    await prisma.workSession.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", logoutAt: null },
    });

    return recompute(existing.id);
  }

  // Late login is measured against THIS PERSON'S shift, never a global time.
  let wasLateLogin = false;
  let lateByMinutes = 0;
  const shiftStartTime = ctx.shift?.startTime ?? null;

  if (shiftStartTime) {
    const [h, m] = shiftStartTime.split(":").map(Number);
    const shiftStart = h * 60 + m;
    const actual = localMinutes(now, ctx.timezone);
    const late = actual - shiftStart - ctx.config.lateLoginGraceMinutes;
    if (late > 0) {
      wasLateLogin = true;
      lateByMinutes = late;
    }
  }

  const created = await prisma.workSession.create({
    data: {
      platformId: ctx.platformId,
      userId,
      date,
      loginAt: now,
      status: "ACTIVE",
      shiftStartTime,
      wasLateLogin,
      lateByMinutes,
    },
  });

  return recompute(created.id);
}

export async function clockOut(userId: string) {
  const ctx = await getContext(userId);
  const date = platformToday(ctx.timezone);
  const now = new Date();

  const session = await prisma.workSession.findUnique({
    where: { userId_date: { userId, date } },
    include: { breaks: true, meetings: true },
  });

  if (!session || session.status !== "ACTIVE") {
    throw new Error("NO_ACTIVE_SESSION");
  }

  // Close anything still running, otherwise the totals would keep growing.
  for (const b of session.breaks) {
    if (!b.endedAt) {
      await prisma.trackerBreak.update({
        where: { id: b.id },
        data: {
          endedAt: now,
          durationSeconds: Math.max(
            0,
            Math.floor((now.getTime() - b.startedAt.getTime()) / 1000)
          ),
        },
      });
    }
  }

  for (const m of session.meetings) {
    if (!m.endedAt && m.startedAt) {
      await prisma.trackerMeeting.update({
        where: { id: m.id },
        data: {
          endedAt: now,
          durationSeconds: Math.max(
            0,
            Math.floor((now.getTime() - m.startedAt.getTime()) / 1000)
          ),
        },
      });
    }
  }

  await prisma.workSession.update({
    where: { id: session.id },
    data: { status: "COMPLETED", logoutAt: now },
  });

  return recompute(session.id);
}

export async function startBreak(userId: string, breakType: string) {
  const ctx = await getContext(userId);
  const date = platformToday(ctx.timezone);

  const session = await prisma.workSession.findUnique({
    where: { userId_date: { userId, date } },
    include: { breaks: true, meetings: true },
  });

  if (!session || session.status !== "ACTIVE") {
    throw new Error("NO_ACTIVE_SESSION");
  }
  if (session.breaks.some((b) => !b.endedAt)) {
    throw new Error("BREAK_ALREADY_RUNNING");
  }
  if (session.meetings.some((m) => m.startedAt && !m.endedAt)) {
    throw new Error("MEETING_RUNNING");
  }

  await prisma.trackerBreak.create({
    data: {
      workSessionId: session.id,
      breakType: breakType as any,
      startedAt: new Date(),
    },
  });

  return recompute(session.id);
}

export async function endBreak(userId: string) {
  const ctx = await getContext(userId);
  const date = platformToday(ctx.timezone);

  const session = await prisma.workSession.findUnique({
    where: { userId_date: { userId, date } },
    include: { breaks: true },
  });

  if (!session) throw new Error("NO_ACTIVE_SESSION");

  const open = session.breaks.find((b) => !b.endedAt);
  if (!open) throw new Error("NO_BREAK_RUNNING");

  const now = new Date();
  await prisma.trackerBreak.update({
    where: { id: open.id },
    data: {
      endedAt: now,
      durationSeconds: Math.max(
        0,
        Math.floor((now.getTime() - open.startedAt.getTime()) / 1000)
      ),
    },
  });

  return recompute(session.id);
}

// ---------------------------------------------------------------------------
// INVITE FLOW
// Only a manager can start a meeting. Each invited employee gets a PENDING
// row. The clock does NOT run while pending — startedAt is set at the moment
// the employee accepts, so waiting is never paid time.
// ---------------------------------------------------------------------------
export async function inviteToMeeting(
  managerId: string,
  employeeIds: string[],
  meetingType: string,
  title?: string
) {
  const manager = await prisma.user.findUnique({ where: { id: managerId } });
  if (!manager) throw new Error("USER_NOT_FOUND");
  if (!["MANAGER", "HR", "ADMIN"].includes(manager.role)) {
    throw new Error("NOT_ALLOWED");
  }

  const invited: string[] = [];
  const skipped: { userId: string; reason: string }[] = [];

  for (const employeeId of employeeIds) {
    const ctx = await getContext(employeeId).catch(() => null);
    if (!ctx) {
      skipped.push({ userId: employeeId, reason: "No tracker access" });
      continue;
    }

    const date = platformToday(ctx.timezone);
    const session = await prisma.workSession.findUnique({
      where: { userId_date: { userId: employeeId, date } },
      include: { meetings: true },
    });

    // A meeting attaches to a work session, so they must be clocked in.
    if (!session || session.status !== "ACTIVE") {
      skipped.push({ userId: employeeId, reason: "Not clocked in" });
      continue;
    }
    if (session.meetings.some((m) => m.approvalStatus === "PENDING")) {
      skipped.push({
        userId: employeeId,
        reason: "Already has a pending invite",
      });
      continue;
    }
    if (
      session.meetings.some(
        (m) => m.approvalStatus === "APPROVED" && m.startedAt && !m.endedAt
      )
    ) {
      skipped.push({ userId: employeeId, reason: "Already in a meeting" });
      continue;
    }

    await prisma.trackerMeeting.create({
      data: {
        workSessionId: session.id,
        meetingType: meetingType as any,
        title: title ?? null,
        approvalStatus: "PENDING",
        invitedById: managerId,
        attendeeIds: employeeIds,
      },
    });

    invited.push(employeeId);
  }

  return { invited, skipped };
}

// What the employee's notification badge polls for.
export async function listPendingInvites(userId: string) {
  const ctx = await getContext(userId);
  const date = platformToday(ctx.timezone);

  const session = await prisma.workSession.findUnique({
    where: { userId_date: { userId, date } },
    include: {
      meetings: {
        where: { approvalStatus: "PENDING" },
        include: {
          invitedBy: {
            select: { firstName: true, lastName: true, role: true },
          },
        },
        orderBy: { requestedAt: "desc" },
      },
    },
  });

  return session?.meetings ?? [];
}

export async function respondToMeeting(
  userId: string,
  meetingId: string,
  accept: boolean,
  reason?: string
) {
  const meeting = await prisma.trackerMeeting.findUnique({
    where: { id: meetingId },
    include: { workSession: true },
  });

  if (!meeting) throw new Error("MEETING_NOT_FOUND");
  // Ownership check: you can only answer an invite addressed to you.
  if (meeting.workSession.userId !== userId) throw new Error("NOT_YOURS");
  if (meeting.approvalStatus !== "PENDING") throw new Error("ALREADY_ANSWERED");

  const now = new Date();

  if (accept) {
    await prisma.trackerMeeting.update({
      where: { id: meetingId },
      data: {
        approvalStatus: "APPROVED",
        reviewedAt: now,
        reviewedById: userId,
        startedAt: now, // the clock starts HERE, not when invited
      },
    });
  } else {
    await prisma.trackerMeeting.update({
      where: { id: meetingId },
      data: {
        approvalStatus: "REJECTED",
        reviewedAt: now,
        reviewedById: userId,
        rejectionReason: reason ?? null,
        endedAt: now,
        durationSeconds: 0,
      },
    });
  }

  return recompute(meeting.workSessionId);
}

export async function endMeeting(userId: string) {
  const ctx = await getContext(userId);
  const date = platformToday(ctx.timezone);

  const session = await prisma.workSession.findUnique({
    where: { userId_date: { userId, date } },
    include: { meetings: true },
  });

  if (!session) throw new Error("NO_ACTIVE_SESSION");

  const open = session.meetings.find(
    (m) => m.approvalStatus === "APPROVED" && m.startedAt && !m.endedAt
  );
  if (!open) throw new Error("NO_MEETING_RUNNING");

  const now = new Date();
  await prisma.trackerMeeting.update({
    where: { id: open.id },
    data: {
      endedAt: now,
      durationSeconds: Math.max(
        0,
        Math.floor((now.getTime() - open.startedAt!.getTime()) / 1000)
      ),
    },
  });

  return recompute(session.id);
}
// ---------------------------------------------------------------------------
// LIVE TEAM
// A manager sees their own teams; HR and Admin see the whole platform.
// Totals are adjusted on read using updatedAt (the last recompute) so the
// view is live without writing to the database on every poll.
// ---------------------------------------------------------------------------
export async function getTeamLiveStatus(viewerId: string) {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    include: { platform: true },
  });

  if (!viewer) throw new Error("USER_NOT_FOUND");
  if (!["MANAGER", "HR", "ADMIN"].includes(viewer.role)) {
    throw new Error("NOT_ALLOWED");
  }

  const timezone = viewer.platform.timezone;
  const date = platformToday(timezone);

  const teams = await prisma.team.findMany({
    where:
      viewer.role === "MANAGER"
        ? { managerId: viewerId, isActive: true }
        : { platformId: viewer.platformId, isActive: true },
    include: {
      config: true,
      members: { where: { isActive: true }, include: { user: true } },
    },
  });

  const userIds = teams.flatMap((t) => t.members.map((m) => m.userId));

  const sessions = await prisma.workSession.findMany({
    where: { userId: { in: userIds }, date },
    include: { breaks: true, meetings: true },
  });

  const leaveDays = await prisma.leaveDay.findMany({
    where: { userId: { in: userIds }, date },
  });

  const byUser = new Map(sessions.map((s) => [s.userId, s]));
  const onLeave = new Set(leaveDays.map((l) => l.userId));
  const now = Date.now();

  const rows = teams.flatMap((team) =>
    team.members.map((member) => {
      const s = byUser.get(member.userId) ?? null;

      const openBreak = s?.breaks.find((b) => !b.endedAt) ?? null;
      const openMeeting =
        s?.meetings.find(
          (m) => m.approvalStatus === "APPROVED" && m.startedAt && !m.endedAt
        ) ?? null;
      const pendingInvite =
        s?.meetings.some((m) => m.approvalStatus === "PENDING") ?? false;

      let status: string;
      if (onLeave.has(member.userId)) status = "ON_LEAVE";
      else if (!s) status = "NOT_CLOCKED_IN";
      else if (s.status === "COMPLETED") status = "DONE";
      else if (openBreak) status = "ON_BREAK";
      else if (openMeeting) status = "IN_MEETING";
      else status = "WORKING";

      let productiveSeconds = s?.productiveSeconds ?? 0;
      let breakSeconds = s?.breakSeconds ?? 0;
      let meetingSeconds = s?.meetingSeconds ?? 0;

      if (s && s.status === "ACTIVE") {
        const since = Math.max(
          0,
          Math.floor((now - s.updatedAt.getTime()) / 1000)
        );
        if (openBreak) breakSeconds += since;
        else if (openMeeting) meetingSeconds += since;
        else productiveSeconds += since;
      }

      return {
        userId: member.userId,
        name: `${member.user.firstName} ${member.user.lastName}`,
        employeeCode: member.user.employeeCode,
        designation: member.user.designation,
        teamName: team.name,
        status,
        pendingInvite,
        breakType: openBreak?.breakType ?? null,
        loginAt: s?.loginAt ?? null,
        wasLateLogin: s?.wasLateLogin ?? false,
        lateByMinutes: s?.lateByMinutes ?? 0,
        productiveSeconds,
        breakSeconds,
        meetingSeconds,
        productiveTarget: (team.config?.productiveHours ?? 8) * 3600,
        breakBudget: (team.config?.breakBudgetMinutes ?? 60) * 60,
      };
    })
  );

  // Someone in two teams would otherwise appear twice. Keep the first.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.userId)) return false;
    seen.add(r.userId);
    return true;
  });

  unique.sort((a, b) => a.name.localeCompare(b.name));
  return unique;
}

// ---------------------------------------------------------------------------
// MY HISTORY
// Past days with their totals, plus that day's task score. Defaults to the
// last 30 days. Dates come in as YYYY-MM-DD and are read as UTC midnight,
// matching how the day is stored.
// ---------------------------------------------------------------------------
const TASK_WEIGHTS: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 5,
};

export async function getHistory(
  userId: string,
  fromStr?: string,
  toStr?: string
) {
  const ctx = await getContext(userId);
  const today = platformToday(ctx.timezone);

  const to = toStr ? new Date(`${toStr}T00:00:00Z`) : today;
  const from = fromStr
    ? new Date(`${fromStr}T00:00:00Z`)
    : new Date(to.getTime() - 29 * 86400000);

  const [sessions, leaveDays, tasks] = await Promise.all([
    prisma.workSession.findMany({
      where: { userId, date: { gte: from, lte: to } },
      include: { breaks: true, meetings: true },
      orderBy: { date: "desc" },
    }),
    prisma.leaveDay.findMany({
      where: { userId, date: { gte: from, lte: to } },
    }),
    prisma.dailyTask.findMany({
      where: { userId, date: { gte: from, lte: to } },
    }),
  ]);

  const key = (d: Date) => d.toISOString().slice(0, 10);

  const leaveByDate = new Map(leaveDays.map((l) => [key(l.date), l]));

  const tasksByDate = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const k = key(t.date);
    if (!tasksByDate.has(k)) tasksByDate.set(k, []);
    tasksByDate.get(k)!.push(t);
  }

  const rows = sessions.map((s) => {
    const k = key(s.date);
    const dayTasks = tasksByDate.get(k) ?? [];

    const totalWeight = dayTasks.reduce(
      (n, t) => n + (TASK_WEIGHTS[t.weight] ?? 1),
      0
    );
    const doneWeight = dayTasks
      .filter((t) => t.status === "COMPLETED")
      .reduce((n, t) => n + (TASK_WEIGHTS[t.weight] ?? 1), 0);

    return {
      date: k,
      loginAt: s.loginAt,
      logoutAt: s.logoutAt,
      status: s.status,
      productiveSeconds: s.productiveSeconds,
      breakSeconds: s.breakSeconds,
      meetingSeconds: s.meetingSeconds,
      breakCount: s.breaks.length,
      meetingCount: s.meetings.filter((m) => m.approvalStatus === "APPROVED")
        .length,
      wasLateLogin: s.wasLateLogin,
      lateByMinutes: s.lateByMinutes,
      autoClosed: s.autoClosed,
      onLeave: leaveByDate.has(k),
      leaveType: leaveByDate.get(k)?.leaveType ?? null,
      taskTotal: dayTasks.length,
      taskDone: dayTasks.filter((t) => t.status === "COMPLETED").length,
      taskPercent:
        totalWeight === 0 ? null : Math.round((doneWeight / totalWeight) * 100),
    };
  });

  const worked = rows.filter((r) => !r.onLeave);
  const totalProductive = worked.reduce((n, r) => n + r.productiveSeconds, 0);
  const scored = worked.filter((r) => r.taskPercent !== null);

  return {
    from: key(from),
    to: key(to),
    target: ctx.config.productiveHours * 3600,
    breakBudget: ctx.config.breakBudgetMinutes * 60,
    rows,
    summary: {
      daysWorked: worked.length,
      daysOnLeave: rows.filter((r) => r.onLeave).length,
      daysLate: worked.filter((r) => r.wasLateLogin).length,
      totalProductive,
      avgProductive: worked.length
        ? Math.round(totalProductive / worked.length)
        : 0,
      totalBreak: worked.reduce((n, r) => n + r.breakSeconds, 0),
      totalMeeting: worked.reduce((n, r) => n + r.meetingSeconds, 0),
      avgTaskScore: scored.length
        ? Math.round(
            scored.reduce((n, r) => n + (r.taskPercent ?? 0), 0) / scored.length
          )
        : null,
    },
  };
}   

// ---------------------------------------------------------------------------
// ALERTS for the manager view. Only today's, only unacknowledged.
// ---------------------------------------------------------------------------
export async function listTeamAlerts(viewerId: string) {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    include: { platform: true },
  });
  if (!viewer) throw new Error("USER_NOT_FOUND");
  if (!["MANAGER", "HR", "ADMIN"].includes(viewer.role)) {
    throw new Error("NOT_ALLOWED");
  }

  const today = platformToday(viewer.platform.timezone);

  const teams = await prisma.team.findMany({
    where:
      viewer.role === "MANAGER"
        ? { managerId: viewerId, isActive: true }
        : { platformId: viewer.platformId, isActive: true },
    include: { members: { where: { isActive: true }, select: { userId: true } } },
  });

  const userIds = [
    ...new Set(teams.flatMap((t) => t.members.map((m) => m.userId))),
  ];

  const alerts = await prisma.alert.findMany({
    where: { userId: { in: userIds }, date: today, acknowledgedAt: null },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
  });

  return alerts.map((a) => ({
    id: a.id,
    userId: a.userId,
    name: `${a.user.firstName} ${a.user.lastName}`,
    alertType: a.alertType,
    severity: a.severity,
    message: a.message,
    createdAt: a.createdAt,
  }));
}

export async function acknowledgeAlert(viewerId: string, alertId: string) {
  const viewer = await prisma.user.findUnique({ where: { id: viewerId } });
  if (!viewer) throw new Error("USER_NOT_FOUND");
  if (!["MANAGER", "HR", "ADMIN"].includes(viewer.role)) {
    throw new Error("NOT_ALLOWED");
  }

  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new Error("ALERT_NOT_FOUND");
  // Same platform only — a manager cannot clear another company's alerts.
  if (alert.platformId !== viewer.platformId) throw new Error("NOT_ALLOWED");

  await prisma.alert.update({
    where: { id: alertId },
    data: { acknowledgedAt: new Date(), acknowledgedById: viewerId },
  });

  return listTeamAlerts(viewerId);
}