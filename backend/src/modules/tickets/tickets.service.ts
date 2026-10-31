// ===========================================================================
// TICKETS — HR queries, tech issues, admin requests, attendance corrections
//
// An ATTENDANCE_CORRECTION is the only sanctioned way to change a recorded
// work session. Approving one writes the requested times to the session,
// recomputes the totals with the same function clock-out uses, and stamps
// appliedAt so the same approval can never be applied twice.
// ===========================================================================

import { prisma } from "../../lib/prisma.js";
import { parseIsoDay } from "../../lib/dates.js";
import { recompute } from "../tracker/tracker.service.js";

export const TICKET_CATEGORIES = [
  "HR_QUERY",
  "TECH_ISSUE",
  "ADMIN_REQUEST",
  "ATTENDANCE_CORRECTION",
] as const;
export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "REJECTED",
] as const;
export const TICKET_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

type Category = (typeof TICKET_CATEGORIES)[number];
type Status = (typeof TICKET_STATUSES)[number];
type Priority = (typeof TICKET_PRIORITIES)[number];

// Response-time targets in hours. Config-driven would be better; these are
// deliberately one place so moving them to TeamConfig later is a small job.
const TARGET_HOURS: Record<Category, number> = {
  HR_QUERY: 24,
  TECH_ISSUE: 8,
  ADMIN_REQUEST: 48,
  ATTENDANCE_CORRECTION: 24,
};

// Who may change a ticket's state, beyond its own assignee.
const STAFF_ROLES = new Set(["MANAGER", "HR", "ADMIN"]);

function parseDay(value: string): Date {
  return parseIsoDay(value);
}

async function actor(viewerId: string) {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { id: true, role: true, platformId: true },
  });
  if (!viewer) throw new Error("NOT_FOUND");
  return viewer;
}

// --- routing ----------------------------------------------------------------
// An unrouted ticket is a ticket nobody sees. If no one holds the right role
// the ticket is still created, unassigned, and Admin's "All" view catches it.

async function resolveAssignee(
  platformId: string,
  category: Category,
  raiserId: string
): Promise<string | null> {
  if (category === "ATTENDANCE_CORRECTION") {
    const membership = await prisma.teamMember.findFirst({
      where: { userId: raiserId, isActive: true, team: { managerId: { not: null } } },
      select: { team: { select: { managerId: true } } },
    });
    if (membership?.team.managerId) return membership.team.managerId;
    // Fall through to an admin rather than leaving it unrouted.
  }

  const wanted = category === "HR_QUERY" ? ["HR", "ADMIN"] : ["ADMIN", "HR"];

  for (const role of wanted) {
    const person = await prisma.user.findFirst({
      where: { platformId, role: role as never, status: "ACTIVE" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (person) return person.id;
  }

  return null;
}

// TKT-000001. Sequential per platform. Under simultaneous creation two
// tickets could compute the same number — the unique constraint on
// (platformId, reference) is the real guard, and the retry below handles it.
async function nextReference(platformId: string): Promise<string> {
  const count = await prisma.ticket.count({ where: { platformId } });
  return `TKT-${String(count + 1).padStart(6, "0")}`;
}

// ===========================================================================
// CREATE
// ===========================================================================

// A clock time from the client must be a real moment, otherwise the database call fails with a 500.
function parseInstant(value: unknown): Date {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error("BAD_TIME");
  return d;
}

export async function createTicket(
  viewerId: string,
  data: {
    category: string;
    subject: string;
    description: string;
    priority?: string;
    correctionDate?: string;
    requestedLoginAt?: string;
    requestedLogoutAt?: string;
  }
) {
  const viewer = await actor(viewerId);

  const category = TICKET_CATEGORIES.find((c) => c === data.category);
  if (!category) throw new Error("BAD_CATEGORY");
  if (!data.subject?.trim() || !data.description?.trim()) throw new Error("MISSING_FIELDS");

  const priority = TICKET_PRIORITIES.find((p) => p === data.priority) ?? "NORMAL";

  // A correction without a date and at least one time is unactionable.
  let correction: {
    correctionDate?: Date;
    requestedLoginAt?: Date;
    requestedLogoutAt?: Date;
  } = {};

  if (category === "ATTENDANCE_CORRECTION") {
    if (!data.correctionDate) throw new Error("MISSING_CORRECTION_DATE");
    const day = parseDay(data.correctionDate);
    if (!data.requestedLoginAt && !data.requestedLogoutAt) {
      throw new Error("MISSING_CORRECTION_TIMES");
    }
    correction = {
      correctionDate: day,
      requestedLoginAt: data.requestedLoginAt ? parseInstant(data.requestedLoginAt) : undefined,
      requestedLogoutAt: data.requestedLogoutAt ? parseInstant(data.requestedLogoutAt) : undefined,
    };
  }

  const assignedToId = await resolveAssignee(viewer.platformId, category, viewer.id);
  const dueAt = new Date(Date.now() + TARGET_HOURS[category] * 3600_000);

  // Two attempts: if another ticket claimed our number in between, recompute
  // and try once more rather than failing the user's request.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.ticket.create({
        data: {
          platformId: viewer.platformId,
          reference: await nextReference(viewer.platformId),
          raisedById: viewer.id,
          category,
          priority: priority as Priority,
          status: "OPEN",
          subject: data.subject.trim(),
          description: data.description.trim(),
          assignedToId,
          dueAt,
          ...correction,
        },
        select: { id: true, reference: true, assignedToId: true },
      });
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }

  throw new Error("UNKNOWN");
}

// ===========================================================================
// LIST
// ===========================================================================

export async function listTickets(
  viewerId: string,
  filters: { scope?: string; status?: string } = {}
) {
  const viewer = await actor(viewerId);

  const scope = filters.scope ?? "mine";
  const status = TICKET_STATUSES.find((s) => s === filters.status);

  // "all" is staff-only. An employee asking for it gets their own tickets,
  // not an error — the UI never offers them the tab in the first place.
  const canSeeAll = STAFF_ROLES.has(String(viewer.role));

  const where =
    scope === "assigned"
      ? { platformId: viewer.platformId, assignedToId: viewer.id }
      : scope === "all" && canSeeAll
        ? { platformId: viewer.platformId }
        : { platformId: viewer.platformId, raisedById: viewer.id };

  const tickets = await prisma.ticket.findMany({
    where: { ...where, ...(status ? { status } : {}) },
    select: {
      id: true,
      reference: true,
      category: true,
      priority: true,
      status: true,
      subject: true,
      dueAt: true,
      resolvedAt: true,
      correctionDate: true,
      appliedAt: true,
      createdAt: true,
      raisedBy: { select: { id: true, firstName: true, lastName: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { messages: true } },
      // Who spoke last in the conversation the raiser can see (internal notes are ignored). Tells "waiting for
      // staff" from "staff have answered".
      messages: { where: { isInternal: false }, orderBy: { createdAt: "desc" }, take: 1, select: { authorId: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  const now = Date.now();

  return tickets.map((t) => ({
    id: t.id,
    reference: t.reference,
    category: t.category,
    priority: t.priority,
    status: t.status,
    subject: t.subject,
    dueAt: t.dueAt,
    // Only an unresolved ticket can be overdue.
    isOverdue:
      !!t.dueAt &&
      !t.resolvedAt &&
      String(t.status) !== "CLOSED" &&
      String(t.status) !== "REJECTED" &&
      t.dueAt.getTime() < now,
    correctionDate: t.correctionDate,
    appliedAt: t.appliedAt,
    createdAt: t.createdAt,
    raisedBy: `${t.raisedBy.firstName} ${t.raisedBy.lastName}`.trim(),
    raisedById: t.raisedBy.id,
    assignedTo: t.assignedTo
      ? `${t.assignedTo.firstName} ${t.assignedTo.lastName}`.trim()
      : null,
    messageCount: t._count.messages,
    // True while the ticket is still waiting for a staff answer: nobody has replied yet, or the last visible
    // message is from the person who raised it. False once staff have answered (until the raiser writes back).
    awaitingReply: t.messages.length === 0 || t.messages[0].authorId === t.raisedBy.id,
  }));
}

// ===========================================================================
// DETAIL
// ===========================================================================

export async function getTicket(viewerId: string, ticketId: string) {
  const viewer = await actor(viewerId);

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      raisedBy: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });

  if (!ticket || ticket.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  const isStaff = STAFF_ROLES.has(String(viewer.role));
  const isMine = ticket.raisedById === viewer.id;
  const isAssignee = ticket.assignedToId === viewer.id;

  if (!isStaff && !isMine) throw new Error("FORBIDDEN");

  return {
    ...ticket,
    // Internal notes are stripped for the person who raised it, so staff can
    // discuss a case without the employee reading the discussion.
    messages: ticket.messages
      .filter((m) => !m.isInternal || isStaff)
      .map((m) => ({
        id: m.id,
        body: m.body,
        isInternal: m.isInternal,
        createdAt: m.createdAt,
        author: `${m.author.firstName} ${m.author.lastName}`.trim(),
        authorId: m.author.id,
      })),
    permissions: {
      canReply: isMine || isStaff,
      canAddInternalNote: isStaff,
      canChangeStatus: isAssignee || String(viewer.role) === "ADMIN",
      canApplyCorrection:
        String(ticket.category) === "ATTENDANCE_CORRECTION" &&
        !ticket.appliedAt &&
        (isAssignee || String(viewer.role) === "ADMIN"),
    },
  };
}

// ===========================================================================
// MESSAGES
// ===========================================================================

export async function addMessage(
  viewerId: string,
  ticketId: string,
  body: string,
  isInternal = false
) {
  const viewer = await actor(viewerId);
  if (!body?.trim()) throw new Error("MISSING_FIELDS");

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { platformId: true, raisedById: true, firstReplyAt: true, status: true },
  });
  if (!ticket || ticket.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  const isStaff = STAFF_ROLES.has(String(viewer.role));
  if (!isStaff && ticket.raisedById !== viewer.id) throw new Error("FORBIDDEN");

  // Only staff can write a note the raiser cannot see.
  const internal = isInternal && isStaff;

  // firstReplyAt is the response-time clock, so it is stamped by the first
  // reply from someone OTHER than the person who raised it, and only once.
  const isFirstStaffReply =
    !ticket.firstReplyAt && viewer.id !== ticket.raisedById && !internal;

  await prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: { ticketId, authorId: viewer.id, body: body.trim(), isInternal: internal },
    });

    if (isFirstStaffReply || String(ticket.status) === "OPEN") {
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          ...(isFirstStaffReply ? { firstReplyAt: new Date() } : {}),
          ...(String(ticket.status) === "OPEN" && viewer.id !== ticket.raisedById
            ? { status: "IN_PROGRESS" as Status }
            : {}),
        },
      });
    }
  });

  return { ok: true };
}

// ===========================================================================
// STATUS + CORRECTION
// ===========================================================================

export async function updateTicket(
  viewerId: string,
  ticketId: string,
  data: { status?: string; priority?: string; assignedToId?: string; resolutionNote?: string }
) {
  const viewer = await actor(viewerId);

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { platformId: true, assignedToId: true, status: true },
  });
  if (!ticket || ticket.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  const isAdmin = String(viewer.role) === "ADMIN";
  if (ticket.assignedToId !== viewer.id && !isAdmin) throw new Error("FORBIDDEN");

  const status = TICKET_STATUSES.find((s) => s === data.status);
  const priority = TICKET_PRIORITIES.find((p) => p === data.priority);

  await prisma.ticket.update({
    where: { id: ticketId },
    data: {
      ...(status
        ? {
            status,
            ...(status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
            ...(status === "CLOSED" ? { closedAt: new Date() } : {}),
          }
        : {}),
      ...(priority ? { priority } : {}),
      ...(data.assignedToId !== undefined
        ? { assignedToId: data.assignedToId || null }
        : {}),
      ...(data.resolutionNote !== undefined
        ? { resolutionNote: data.resolutionNote?.trim() || null }
        : {}),
    },
  });

  return { ok: true };
}

// Writes an approved correction to the work session. This is the ONLY path
// by which recorded attendance changes.
export async function applyCorrection(viewerId: string, ticketId: string) {
  const viewer = await actor(viewerId);

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      platformId: true,
      category: true,
      assignedToId: true,
      raisedById: true,
      appliedAt: true,
      correctionDate: true,
      requestedLoginAt: true,
      requestedLogoutAt: true,
    },
  });

  if (!ticket || ticket.platformId !== viewer.platformId) throw new Error("NOT_FOUND");
  if (String(ticket.category) !== "ATTENDANCE_CORRECTION") throw new Error("NOT_A_CORRECTION");

  const isAdmin = String(viewer.role) === "ADMIN";
  if (ticket.assignedToId !== viewer.id && !isAdmin) throw new Error("FORBIDDEN");

  // The guard that makes approving twice harmless.
  if (ticket.appliedAt) throw new Error("ALREADY_APPLIED");
  if (!ticket.correctionDate) throw new Error("MISSING_CORRECTION_DATE");

  const existing = await prisma.workSession.findUnique({
    where: { userId_date: { userId: ticket.raisedById, date: ticket.correctionDate } },
    select: { id: true, loginAt: true },
  });

  const loginAt = ticket.requestedLoginAt ?? existing?.loginAt ?? ticket.correctionDate;

  const session = existing
    ? await prisma.workSession.update({
        where: { id: existing.id },
        data: {
          loginAt,
          ...(ticket.requestedLogoutAt
            ? { logoutAt: ticket.requestedLogoutAt, status: "COMPLETED" as const }
            : {}),
          notes: `Corrected via ticket on ${new Date().toISOString().slice(0, 10)}`,
        },
        select: { id: true },
      })
    : await prisma.workSession.create({
        // No session at all — they never clocked in that day, which is the
        // most common reason for raising a correction in the first place.
        data: {
          platformId: ticket.platformId,
          userId: ticket.raisedById,
          date: ticket.correctionDate,
          loginAt,
          logoutAt: ticket.requestedLogoutAt ?? null,
          status: ticket.requestedLogoutAt ? "COMPLETED" : "ACTIVE",
          notes: "Created via attendance correction ticket",
        },
        select: { id: true },
      });

  // Same function clock-out uses. Totals are never calculated twice ways.
  await recompute(session.id);

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { appliedAt: new Date(), status: "RESOLVED", resolvedAt: new Date() },
  });

  return { ok: true, sessionId: session.id };
}

// Counts for the tab badges, in one query rather than three list calls.
export async function getTicketCounts(viewerId: string) {
  const viewer = await actor(viewerId);
  const open = { in: ["OPEN", "IN_PROGRESS"] as Status[] };

  const [mine, assigned, overdue] = await Promise.all([
    prisma.ticket.count({
      where: { platformId: viewer.platformId, raisedById: viewer.id, status: open },
    }),
    prisma.ticket.count({
      where: { platformId: viewer.platformId, assignedToId: viewer.id, status: open },
    }),
    prisma.ticket.count({
      where: {
        platformId: viewer.platformId,
        status: open,
        dueAt: { lt: new Date() },
      },
    }),
  ]);

  return { mine, assigned, overdue };
}