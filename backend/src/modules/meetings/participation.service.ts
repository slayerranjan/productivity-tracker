import { prisma } from "../../lib/prisma.js";
import { localDayOf, zonedToUtc } from "../../lib/dates.js";
import { auditNote } from "../../lib/auditContext.js";
import { notifyUsers } from "../../lib/notify.js";
import { emitMeetingChange } from "../../lib/realtime.js";
import * as L from "./participation.logic.js";

// ---------------------------------------------------------------------------
// IN-PERSON MEETING PARTICIPATION (self-reported)
//
// Rules, in one place:
//   - Only the people INVITED to a tracked meeting can join it, and only for themselves.
//   - The SERVER stamps every join and exit. A person can never type or edit their own times.
//   - Join window: 15 minutes before the start until the expected end. After that only the organizing manager can
//     add someone, through a correction (with a reason, kept as history).
//   - One join and one end per person per meeting (unique pair). A return needs a manager correction.
//   - The organizing manager sees the live list. HR and Admin see only the counts (invited, joined).
//   - Nothing here touches attendance, clock-in/out, breaks, working hours or productivity.
// Safe before the migration: if the tables are not there, tracking is simply unavailable.
// ---------------------------------------------------------------------------

const CREATORS = ["MANAGER", "HR", "ADMIN"];
const OVERSIGHT = ["HR", "ADMIN"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

async function who(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, platformId: true, firstName: true, lastName: true, platform: { select: { timezone: true } } },
  });
  if (!u) throw new Error("USER_NOT_FOUND");
  return { id: u.id, role: String(u.role), platformId: u.platformId, name: `${u.firstName} ${u.lastName}`.trim(), tz: u.platform.timezone };
}

// --- is the schema there? -----------------------------------------------------------------------

const isMissingTable = (e: unknown) => {
  const code = (e as { code?: unknown })?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2021" || (/meeting_(tracking|participation)/.test(msg) && /does not exist|relation/.test(msg));
};
let readyValue = false;
let readyCheckedAt = 0;
export async function participationReady(): Promise<boolean> {
  if (readyValue) return true;
  if (Date.now() - readyCheckedAt < 15_000) return false;
  readyCheckedAt = Date.now();
  try {
    await Promise.all([
      prisma.meetingTracking.findFirst({ select: { meetingId: true } }),
      prisma.meetingParticipation.findFirst({ select: { id: true } }),
      prisma.meetingParticipationChange.findFirst({ select: { id: true } }),
    ]);
    readyValue = true;
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    readyValue = false;
  }
  return readyValue;
}
async function requireReady() {
  if (!(await participationReady())) throw new Error("FEATURES_NOT_READY");
}
const isUnique = (e: unknown) => (e as { code?: unknown })?.code === "P2002";

// --- used by the Meetings module -----------------------------------------------------------------------

type Tx = Pick<typeof prisma, "meetingTracking">;

/** Switch tracking on for a new meeting (called inside the same transaction that creates it). */
export async function enableTracking(tx: Tx, o: { meetingId: string; platformId: string; createdById: string; lateAfterMinutes: number }) {
  await tx.meetingTracking.create({ data: { meetingId: o.meetingId, platformId: o.platformId, createdById: o.createdById, lateAfterMinutes: o.lateAfterMinutes } });
}

export function cleanLateAfter(v: unknown): number {
  if (v === undefined || v === null || v === "") return 5;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 120) throw new Error("BAD_LATE_MINUTES");
  return n;
}

type Item = { id: string; startsAt: Date; endsAt: Date; isOrganizer: boolean; status: string };

/** Extra fields for meetings that have tracking on (nothing is added to the others). Never throws for a missing table. */
export async function extrasFor(items: Item[], viewerId: string, now: Date) {
  const out = new Map<string, Record<string, unknown>>();
  if (items.length === 0 || !(await participationReady())) return out;
  const ids = items.map((i) => i.id);
  const tracked = await prisma.meetingTracking.findMany({ where: { meetingId: { in: ids } }, select: { meetingId: true, lateAfterMinutes: true } });
  if (tracked.length === 0) return out;
  const trackedIds = tracked.map((t) => t.meetingId);
  const [mine, joined] = await Promise.all([
    prisma.meetingParticipation.findMany({ where: { meetingId: { in: trackedIds }, userId: viewerId } }),
    prisma.meetingParticipation.groupBy({ by: ["meetingId"], where: { meetingId: { in: trackedIds } }, _count: { _all: true } }),
  ]);
  const mineBy = new Map(mine.map((p) => [p.meetingId, p]));
  const joinedBy = new Map(joined.map((j) => [j.meetingId, j._count._all]));
  const itemBy = new Map(items.map((i) => [i.id, i]));
  for (const t of tracked) {
    const it = itemBy.get(t.meetingId)!;
    const w = L.joinWindow(it.startsAt, it.endsAt, now);
    const p = mineBy.get(t.meetingId) ?? null;
    out.set(t.meetingId, {
      tracked: true,
      lateAfterMinutes: t.lateAfterMinutes,
      joinWindow: { open: w.open, reason: w.reason, opensAt: w.opensAt, closesAt: w.closesAt },
      // The viewer's OWN record (an invitee). The organizer has none: they run the meeting.
      me: it.isOrganizer
        ? null
        : p
          ? {
              state: L.stateOf(p),
              joinedAt: p.joinedAt,
              leftAt: p.leftAt,
              durationSeconds: p.durationSeconds,
              late: L.isLate(p.joinedAt, it.startsAt, t.lateAfterMinutes),
              source: p.source,
              stillActivePastEnd: L.isStillActivePastEnd(p, it.endsAt, now),
            }
          : { state: "NOT_JOINED" as const },
      canJoin: !it.isOrganizer && !p && it.status === "SCHEDULED" && w.open,
      joinedCount: it.isOrganizer ? joinedBy.get(t.meetingId) ?? 0 : undefined,
    });
  }
  return out;
}

/** HR/Admin oversight: how many joined, per meeting. Counts only. */
export async function joinedCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0 || !(await participationReady())) return out;
  const tracked = await prisma.meetingTracking.findMany({ where: { meetingId: { in: ids } }, select: { meetingId: true } });
  if (tracked.length === 0) return out;
  const rows = await prisma.meetingParticipation.groupBy({ by: ["meetingId"], where: { meetingId: { in: tracked.map((t) => t.meetingId) } }, _count: { _all: true } });
  for (const t of tracked) out.set(t.meetingId, 0);
  for (const r of rows) out.set(r.meetingId, r._count._all);
  return out;
}

// --- the employee: join and end ----------------------------------------------------------------------

export async function join(userId: string, meetingId: string) {
  await requireReady();
  const v = await who(userId);
  // Not invited = it does not exist as far as this person can tell (same privacy rule as the rest of Meetings).
  const m = await prisma.meeting.findFirst({
    where: { id: meetingId, platformId: v.platformId, attendees: { some: { userId } } },
    select: { id: true, title: true, startsAt: true, endsAt: true, status: true, organizerId: true },
  });
  if (!m) throw new Error("NOT_FOUND");
  const t = await prisma.meetingTracking.findUnique({ where: { meetingId } });
  if (!t) throw new Error("NOT_TRACKED");
  if (String(m.status) === "CANCELLED") throw new Error("MEETING_CANCELLED");

  const now = new Date(); // ONE reading of the clock: the same instant decides the window and is recorded as the join
  const w = L.joinWindow(m.startsAt, m.endsAt, now);
  if (!w.open) throw new Error(w.reason === "TOO_EARLY" ? "JOIN_TOO_EARLY" : "JOIN_CLOSED");

  try {
    await prisma.meetingParticipation.create({ data: { meetingId, platformId: v.platformId, userId, joinedAt: now, source: "SELF" } });
  } catch (e) {
    if (isUnique(e)) throw new Error("ALREADY_JOINED");
    throw e;
  }
  auditNote({ recordType: "Meeting", recordId: meetingId, summary: `Declared joining "${m.title}"`, after: { joinedAt: now } });
  emitMeetingChange([userId, m.organizerId], meetingId);
  return { ok: true, joinedAt: now, late: L.isLate(now, m.startsAt, t.lateAfterMinutes) };
}

export async function leave(userId: string, meetingId: string) {
  await requireReady();
  const v = await who(userId);
  const p = await prisma.meetingParticipation.findUnique({ where: { meetingId_userId: { meetingId, userId } } });
  if (!p || p.platformId !== v.platformId) throw new Error("NOT_JOINED");
  if (p.leftAt) throw new Error("ALREADY_ENDED");

  const m = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { organizerId: true, title: true } });
  const now = new Date();
  // Claim the exit only while it is still open, so a double click (or two tabs) records it once.
  const res = await prisma.meetingParticipation.updateMany({
    where: { id: p.id, leftAt: null },
    data: { leftAt: now, durationSeconds: L.durationSeconds(p.joinedAt, now), endedBy: "SELF" },
  });
  if (res.count === 0) throw new Error("ALREADY_ENDED");
  auditNote({ recordType: "Meeting", recordId: meetingId, summary: `Declared leaving "${m?.title ?? "a meeting"}"`, after: { leftAt: now } });
  if (m) emitMeetingChange([userId, m.organizerId], meetingId);
  return { ok: true, leftAt: now, durationSeconds: L.durationSeconds(p.joinedAt, now) };
}

// --- the organizing manager: live list and report ---------------------------------------------------------

export async function list(userId: string, meetingId: string) {
  await requireReady();
  const v = await who(userId);
  const m = await prisma.meeting.findFirst({
    where: { id: meetingId, platformId: v.platformId, organizerId: userId },
    select: { id: true, title: true, startsAt: true, endsAt: true, status: true, attendees: { select: { user: { select: { id: true, firstName: true, lastName: true, employeeCode: true, designation: true } } } } },
  });
  if (!m) throw new Error("NOT_FOUND");
  const t = await prisma.meetingTracking.findUnique({ where: { meetingId } });
  if (!t) throw new Error("NOT_TRACKED");

  const [parts, changes] = await Promise.all([
    prisma.meetingParticipation.findMany({ where: { meetingId } }),
    prisma.meetingParticipationChange.groupBy({ by: ["userId"], where: { meetingId }, _count: { _all: true } }),
  ]);
  const now = new Date();
  const pBy = new Map(parts.map((p) => [p.userId, p]));
  const corrected = new Set(changes.map((c) => c.userId));

  const rows = m.attendees
    .map((a) => {
      const p = pBy.get(a.user.id) ?? null;
      const late = p ? L.isLate(p.joinedAt, m.startsAt, t.lateAfterMinutes) : false;
      return {
        userId: a.user.id,
        name: `${a.user.firstName} ${a.user.lastName}`.trim(),
        employeeCode: a.user.employeeCode,
        designation: a.user.designation,
        state: L.stateOf(p),
        joinedAt: p?.joinedAt ?? null,
        leftAt: p?.leftAt ?? null,
        durationSeconds: p?.durationSeconds ?? null,
        late,
        minutesAfterStart: p && late ? L.minutesAfterStart(p.joinedAt, m.startsAt) : null,
        stillActivePastEnd: p ? L.isStillActivePastEnd(p, m.endsAt, now) : false,
        source: p?.source ?? null,
        corrected: corrected.has(a.user.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const joined = rows.filter((r) => r.state !== "NOT_JOINED");
  const ended = rows.filter((r) => r.state === "ENDED");
  const span = L.actualSpan(parts, now);
  return {
    meeting: { id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, status: String(m.status) },
    timezone: v.tz,
    now: now.toISOString(),
    lateAfterMinutes: t.lateAfterMinutes,
    selfReported: true,
    summary: {
      invited: rows.length,
      joined: joined.length,
      notJoined: rows.length - joined.length,
      inMeeting: rows.filter((r) => r.state === "IN_MEETING").length,
      ended: ended.length,
      late: rows.filter((r) => r.late).length,
      stillActivePastEnd: rows.filter((r) => r.stillActivePastEnd).length,
      actualDurationSeconds: span?.seconds ?? null,
      actualDurationOngoing: span?.ongoing ?? false,
      averageParticipationSeconds: ended.length ? Math.round(ended.reduce((n, r) => n + (r.durationSeconds ?? 0), 0) / ended.length) : null,
    },
    rows,
  };
}

// --- the organizing manager: corrections (always with a reason, always kept as history) -------------------------

export async function correct(userId: string, meetingId: string, targetUserId: string, body: { joinedAt?: unknown; leftAt?: unknown; clearLeft?: unknown; reason?: unknown }) {
  await requireReady();
  const v = await who(userId);
  if (!CREATORS.includes(v.role)) throw new Error("NOT_ALLOWED");
  const m = await prisma.meeting.findFirst({
    where: { id: meetingId, platformId: v.platformId, organizerId: userId },
    select: { id: true, title: true, startsAt: true, attendees: { select: { userId: true } } },
  });
  if (!m) throw new Error("NOT_FOUND");
  if (!(await prisma.meetingTracking.findUnique({ where: { meetingId } }))) throw new Error("NOT_TRACKED");
  if (!m.attendees.some((a) => a.userId === targetUserId)) throw new Error("NOT_INVITED");

  const reason = String(body.reason ?? "").trim();
  if (reason.length < 5) throw new Error("REASON_REQUIRED");
  if (reason.length > 300) throw new Error("REASON_TOO_LONG");

  // Times are typed as HH:MM in the company timezone, on the meeting's own day.
  const day = localDayOf(m.startsAt, v.tz);
  const parse = (x: unknown): Date | null => {
    if (x === undefined || x === null || x === "") return null;
    const s = String(x);
    if (!HHMM.test(s)) throw new Error("BAD_TIME");
    return zonedToUtc(day, s, v.tz);
  };
  const wantJoin = parse(body.joinedAt);
  const wantLeft = parse(body.leftAt);
  const clearLeft = body.clearLeft === true;
  if (clearLeft && wantLeft) throw new Error("BAD_TIME");

  const now = new Date();
  const existing = await prisma.meetingParticipation.findUnique({ where: { meetingId_userId: { meetingId, userId: targetUserId } } });

  let newJoined: Date;
  let newLeft: Date | null;
  if (!existing) {
    if (!wantJoin) throw new Error("JOIN_TIME_REQUIRED"); // recording someone as present needs the time they joined
    newJoined = wantJoin;
    newLeft = wantLeft;
  } else {
    newJoined = wantJoin ?? existing.joinedAt;
    newLeft = clearLeft ? null : wantLeft ?? existing.leftAt;
    const same = newJoined.getTime() === existing.joinedAt.getTime() && (newLeft?.getTime() ?? null) === (existing.leftAt?.getTime() ?? null);
    if (same) throw new Error("NOTHING_TO_CHANGE");
  }
  if (newJoined.getTime() > now.getTime() || (newLeft && newLeft.getTime() > now.getTime())) throw new Error("TIME_IN_FUTURE");
  if (newLeft && newLeft.getTime() < newJoined.getTime()) throw new Error("END_BEFORE_JOIN");

  const leftChanged = newLeft !== null && newLeft.getTime() !== (existing?.leftAt?.getTime() ?? -1);
  const data = {
    joinedAt: newJoined,
    leftAt: newLeft,
    durationSeconds: newLeft ? L.durationSeconds(newJoined, newLeft) : null,
    endedBy: newLeft ? (leftChanged ? "MANAGER" : existing?.endedBy ?? "MANAGER") : null,
  };
  try {
    await prisma.$transaction(async (tx) => {
      if (existing) await tx.meetingParticipation.update({ where: { id: existing.id }, data });
      else await tx.meetingParticipation.create({ data: { meetingId, platformId: v.platformId, userId: targetUserId, source: "MANAGER_ADDED", ...data } });
      await tx.meetingParticipationChange.create({
        data: {
          meetingId, userId: targetUserId, actedById: userId, action: existing ? "EDIT" : "ADD", reason,
          beforeJoinedAt: existing?.joinedAt ?? null, beforeLeftAt: existing?.leftAt ?? null, afterJoinedAt: newJoined, afterLeftAt: newLeft,
        },
      });
    });
  } catch (e) {
    if (isUnique(e)) throw new Error("ALREADY_JOINED"); // the person pressed Join at the same moment
    throw e;
  }

  auditNote({
    recordType: "Meeting", recordId: meetingId, targetUserId,
    summary: `${existing ? "Corrected" : "Added"} participation in "${m.title}"`,
    before: existing ? { joinedAt: existing.joinedAt, leftAt: existing.leftAt } : null,
    after: { joinedAt: newJoined, leftAt: newLeft, reason },
  });
  emitMeetingChange([userId, targetUserId], meetingId);
  // Tell the person, so a corrected record is never a surprise (never allowed to fail the correction).
  await notifyUsers({
    platformId: v.platformId, userIds: [targetUserId], type: "MEETING_PARTICIPATION_CORRECTED",
    title: `Your participation was updated: ${m.title}`,
    body: `${v.name} ${existing ? "corrected" : "recorded"} your participation in "${m.title}". Reason: ${reason}`,
    link: `/dashboard/meetings?id=${meetingId}`, data: { meetingId },
  });
  return { ok: true };
}

// --- history ------------------------------------------------------------------------------------------------

/** Your own history, or (for the organizing manager) one person's history in the meetings YOU organized. */
export async function history(userId: string, personId?: string) {
  await requireReady();
  const v = await who(userId);
  if (personId && !/^[0-9a-f-]{36}$/i.test(personId)) throw new Error("NOT_FOUND");
  const person = personId && personId !== userId ? personId : userId;
  if (person !== userId && !CREATORS.includes(v.role)) throw new Error("NOT_ALLOWED");

  const invites = await prisma.meetingAttendee.findMany({
    where: { userId: person, meeting: { platformId: v.platformId, status: "SCHEDULED", ...(person !== userId ? { organizerId: userId } : {}) } },
    select: { meeting: { select: { id: true, title: true, startsAt: true, endsAt: true } } },
    orderBy: { meeting: { startsAt: "desc" } },
    take: 200,
  });
  const ids = invites.map((i) => i.meeting.id);
  const tracking = ids.length ? await prisma.meetingTracking.findMany({ where: { meetingId: { in: ids } } }) : [];
  const tBy = new Map(tracking.map((t) => [t.meetingId, t]));
  const trackedIds = tracking.map((t) => t.meetingId);
  const [parts, changes] = trackedIds.length
    ? await Promise.all([
        prisma.meetingParticipation.findMany({ where: { userId: person, meetingId: { in: trackedIds } } }),
        prisma.meetingParticipationChange.groupBy({ by: ["meetingId"], where: { userId: person, meetingId: { in: trackedIds } }, _count: { _all: true } }),
      ])
    : [[], []];
  const pBy = new Map(parts.map((p) => [p.meetingId, p]));
  const cBy = new Set(changes.map((c) => c.meetingId));
  const now = new Date();

  const rows = invites
    .filter((i) => tBy.has(i.meeting.id))
    // A meeting that has not finished yet is not a "missed" meeting: it only appears once there is a record or it is over.
    .filter((i) => pBy.has(i.meeting.id) || i.meeting.endsAt.getTime() < now.getTime())
    .map((i) => {
      const p = pBy.get(i.meeting.id) ?? null;
      const t = tBy.get(i.meeting.id)!;
      return {
        meetingId: i.meeting.id, title: i.meeting.title, startsAt: i.meeting.startsAt, endsAt: i.meeting.endsAt,
        state: L.stateOf(p), joinedAt: p?.joinedAt ?? null, leftAt: p?.leftAt ?? null, durationSeconds: p?.durationSeconds ?? null,
        late: p ? L.isLate(p.joinedAt, i.meeting.startsAt, t.lateAfterMinutes) : false, corrected: cBy.has(i.meeting.id), source: p?.source ?? null,
      };
    });
  const endedRows = rows.filter((r) => r.state === "ENDED");
  return {
    timezone: v.tz,
    selfReported: true,
    personId: person,
    summary: {
      meetings: rows.length,
      joined: rows.filter((r) => r.state !== "NOT_JOINED").length,
      notJoined: rows.filter((r) => r.state === "NOT_JOINED").length,
      late: rows.filter((r) => r.late).length,
      averageSeconds: endedRows.length ? Math.round(endedRows.reduce((n, r) => n + (r.durationSeconds ?? 0), 0) / endedRows.length) : null,
    },
    rows,
  };
}

// --- HR / Admin: counts only ---------------------------------------------------------------------------------------

export async function counts(viewerId: string, meetingId: string) {
  await requireReady();
  const v = await who(viewerId);
  if (!OVERSIGHT.includes(v.role)) throw new Error("NOT_ALLOWED");
  const m = await prisma.meeting.findFirst({ where: { id: meetingId, platformId: v.platformId }, select: { id: true, _count: { select: { attendees: true } } } });
  if (!m) throw new Error("NOT_FOUND");
  if (!(await prisma.meetingTracking.findUnique({ where: { meetingId } }))) throw new Error("NOT_TRACKED");
  return { invited: m._count.attendees, joined: await prisma.meetingParticipation.count({ where: { meetingId } }) };
}
