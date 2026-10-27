import { prisma } from "../../lib/prisma.js";
import { platformToday } from "../../lib/dates.js";

// ---------------------------------------------------------------------------
// SCORING
// A task's worth is its weight. What it earns depends on the manager's grade:
// completed earns all of it, partially completed half, failed nothing.
// Nothing unapproved counts at all.
// ---------------------------------------------------------------------------
export const TASK_WEIGHTS: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 5,
};

export const OUTCOME_MULTIPLIER: Record<string, number> = {
  COMPLETED: 1,
  PARTIALLY_COMPLETED: 0.5,
  FAILED: 0,
};

const WEIGHTS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED"];
const OUTCOMES = ["COMPLETED", "PARTIALLY_COMPLETED", "FAILED"];
const MANAGING_ROLES = ["MANAGER", "HR", "ADMIN"];

async function userContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { platform: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  return {
    user,
    platformId: user.platformId,
    timezone: user.platform.timezone,
    role: String(user.role),
  };
}

// ---------------------------------------------------------------------------
// WHO MAY ACT ON A TASK
//
// The task's PROJECT decides. Priya can be on Sales CRM under Neha and on
// AI Tools under Rahul — a Sales CRM task goes to Neha, an AI Tools task to
// Rahul. Without this, one of them would be grading work they never set.
//
// Falls back to the reporting line for tasks with no project, and Admin/HR
// cover their own company.
// ---------------------------------------------------------------------------
async function assertCanReviewTask(
  actor: { id: string; role: string; platformId: string },
  task: { userId: string; teamId: string | null }
) {
  if (task.teamId) {
    const team = await prisma.team.findUnique({
      where: { id: task.teamId },
      select: { managerId: true },
    });
    if (team?.managerId === actor.id) return;
  }

  const target = await prisma.user.findUnique({
    where: { id: task.userId },
    select: { platformId: true, reportsToId: true },
  });
  if (!target) throw new Error("NOT_YOUR_TEAM");

  if (target.reportsToId === actor.id) return;
  if (
    (actor.role === "ADMIN" || actor.role === "HR") &&
    target.platformId === actor.platformId
  ) {
    return;
  }

  throw new Error("NOT_YOUR_TEAM");
}

// For assigning NEW work, where there is no task to read a project from.
async function assertCanManage(
  actor: { id: string; role: string; platformId: string },
  targetUserId: string
) {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { platformId: true, reportsToId: true },
  });
  if (!target) throw new Error("NOT_YOUR_TEAM");

  if (target.reportsToId === actor.id) return;
  if (
    (actor.role === "ADMIN" || actor.role === "HR") &&
    target.platformId === actor.platformId
  ) {
    return;
  }

  // Or they share a project this manager runs.
  const shared = await prisma.teamMember.findFirst({
    where: {
      userId: targetUserId,
      isActive: true,
      team: { managerId: actor.id, isActive: true },
    },
    select: { id: true },
  });
  if (shared) return;

  throw new Error("NOT_YOUR_TEAM");
}

async function manageableUserIds(actor: {
  id: string;
  role: string;
  platformId: string;
}): Promise<string[]> {
  // Everyone on the teams they run, plus their direct reports. Both can cross
  // companies - at Avatar one person heads teams in several of them.
  const [managedTeams, reports] = await Promise.all([
    prisma.team.findMany({
      where: { managerId: actor.id, isActive: true },
      select: {
        members: { where: { isActive: true }, select: { userId: true } },
      },
    }),
    prisma.user.findMany({
      where: { reportsToId: actor.id },
      select: { id: true },
    }),
  ]);

  const ids = new Set<string>([
    ...managedTeams.flatMap((t) => t.members.map((m) => m.userId)),
    ...reports.map((r) => r.id),
  ]);

  // An admin or HR also sees their own company. Note ADDED to the two lists
  // above, not substituted for them: substituting meant an admin of one
  // company could not approve for a team they personally run in another, so
  // tasks submitted to them sat in nobody's queue and silently expired.
  if (actor.role === "ADMIN" || actor.role === "HR") {
    const all = await prisma.user.findMany({
      where: {
        platformId: actor.platformId,
        status: { in: ["ACTIVE", "INVITED"] },
      },
      select: { id: true },
    });
    for (const u of all) ids.add(u.id);
  }

  return Array.from(ids);
}

async function myProjects(userId: string) {
  const rows = await prisma.teamMember.findMany({
    where: { userId, isActive: true, team: { isActive: true } },
    select: {
      isPrimary: true,
      team: {
        select: {
          id: true,
          name: true,
          platform: { select: { name: true } },
          manager: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.team.id,
    name: r.team.name,
    company: r.team.platform?.name ?? null,
    manager: r.team.manager
      ? `${r.team.manager.firstName} ${r.team.manager.lastName}`.trim()
      : null,
    isPrimary: r.isPrimary,
  }));
}

// ---------------------------------------------------------------------------
// The row the frontend receives. A constrained generic, NOT
// Record<string, unknown> — spreading a Record loses every field from the
// result type.
// ---------------------------------------------------------------------------
function shape<
  T extends {
    id: string;
    title: string;
    description: string | null;
    weight: string;
    status: string;
    approvalStatus: string;
    outcome: string | null;
    rejectionNote: string | null;
    reviewNote: string | null;
    completionNote: string | null;
    assignedById: string | null;
    teamId: string | null;
    date: Date;
  }
>(t: T, projectName?: string | null) {
  return {
    ...t,
    date: t.date.toISOString().slice(0, 10),
    weightValue: TASK_WEIGHTS[String(t.weight)] ?? 1,
    assigned: t.assignedById !== null,
    project: projectName ?? null,
    projectId: t.teamId,
  };
}

type Scorable = {
  weight: string;
  status: string;
  approvalStatus: string;
  outcome: string | null;
};

export function scoreOf(tasks: Scorable[]) {
  const approved = tasks.filter((t) => String(t.approvalStatus) === "APPROVED");

  const totalWeight = approved.reduce(
    (n, t) => n + (TASK_WEIGHTS[String(t.weight)] ?? 1),
    0
  );

  const doneWeight = approved.reduce((n, t) => {
    const w = TASK_WEIGHTS[String(t.weight)] ?? 1;
    if (t.outcome) return n + w * (OUTCOME_MULTIPLIER[String(t.outcome)] ?? 0);
    if (String(t.status) === "COMPLETED") return n + w;
    return n;
  }, 0);

  return {
    total: approved.length,
    done: approved.filter(
      (t) =>
        String(t.status) === "COMPLETED" || String(t.outcome) === "COMPLETED"
    ).length,
    totalWeight,
    doneWeight,
    percent:
      totalWeight === 0 ? 0 : Math.round((doneWeight / totalWeight) * 100),
  };
}

// ---------------------------------------------------------------------------
// EMPLOYEE SIDE
// Every mutation returns the WHOLE refreshed day, because the page replaces
// its state with the response.
// ---------------------------------------------------------------------------
export async function listTasks(userId: string) {
  const ctx = await userContext(userId);
  const date = platformToday(ctx.timezone);

  const [rows, projects] = await Promise.all([
    prisma.dailyTask.findMany({
      where: { userId, date },
      include: { team: { select: { name: true } } },
      orderBy: { title: "asc" },
    }),
    myProjects(userId),
  ]);

  const tasks = rows.map((t) => shape(t, t.team?.name ?? null));

  const working = tasks.filter(
    (t) => t.approvalStatus === "APPROVED" && t.status !== "COMPLETED"
  );
  const awaiting = tasks.filter((t) => t.approvalStatus === "PENDING");
  const score = scoreOf(rows);

  // Per-project totals, so somebody on two projects can see where their day
  // actually went.
  const byProject = projects.map((p) => {
    const mine = rows.filter((t) => t.teamId === p.id);
    return { ...p, taskCount: mine.length, score: scoreOf(mine) };
  });

  return {
    date: date.toISOString().slice(0, 10),
    selfApproves: !ctx.user.reportsToId,
    score,
    scorePercent: score.percent,
    projects,
    byProject,
    awaitingApproval: awaiting,
    pending: awaiting,
    rejected: tasks.filter((t) => t.approvalStatus === "REJECTED"),
    active: working,
    working,
    todays: working,
    inProgress: working,
    done: tasks.filter(
      (t) => t.approvalStatus === "APPROVED" && t.status === "COMPLETED"
    ),
    tasks,
  };
}

// Resolves the project for a new task and refuses one the person isn't on.
async function resolveProject(
  userId: string,
  given: unknown
): Promise<string | null> {
  const projects = await myProjects(userId);
  if (projects.length === 0) return null;

  const wanted = given ? String(given) : "";
  if (wanted) {
    if (!projects.some((p) => p.id === wanted)) throw new Error("NOT_MY_PROJECT");
    return wanted;
  }

  // Not chosen: fall back to the primary project, or the only one they have.
  const primary = projects.find((p) => p.isPrimary);
  if (primary) return primary.id;
  return projects.length === 1 ? projects[0].id : null;
}

export async function proposeTask(userId: string, body: Record<string, unknown>) {
  const ctx = await userContext(userId);

  const title = String(body.title ?? "").trim();
  if (!title) throw new Error("TITLE_REQUIRED");
  if (title.length > 200) throw new Error("TITLE_TOO_LONG");

  const description = body.description
    ? String(body.description).trim().slice(0, 2000)
    : null;

  const weightIn = String(body.weight ?? "MEDIUM");
  const weight = WEIGHTS.includes(weightIn) ? weightIn : "MEDIUM";

  const teamId = await resolveProject(
    userId,
    body.teamId ?? body.projectId ?? null
  );

  const date = platformToday(ctx.timezone);
  const selfApprove = !ctx.user.reportsToId;

  await prisma.dailyTask.create({
    data: {
      platformId: ctx.platformId,
      userId,
      date,
      title,
      description,
      teamId,
      weight: weight as never,
      status: "PENDING" as never,
      approvalStatus: (selfApprove ? "APPROVED" : "PENDING") as never,
      approvedById: selfApprove ? userId : null,
      approvedAt: selfApprove ? new Date() : null,
    },
  });

  return listTasks(userId);
}

export async function updateMyTask(
  userId: string,
  taskId: string,
  body: Record<string, unknown>
) {
  const task = await prisma.dailyTask.findUnique({ where: { id: taskId } });
  if (!task || task.userId !== userId) throw new Error("NOT_FOUND");

  const data: Record<string, unknown> = {};

  if (body.status !== undefined) {
    const status = String(body.status);
    if (!STATUSES.includes(status)) throw new Error("BAD_STATUS");
    if (String(task.approvalStatus) !== "APPROVED") {
      throw new Error("NOT_APPROVED_YET");
    }
    if (task.outcome) throw new Error("ALREADY_REVIEWED");
    data.status = status as never;
  }

  if (body.completionNote !== undefined) {
    data.completionNote = body.completionNote
      ? String(body.completionNote).trim().slice(0, 2000)
      : null;
  }

  // Editing the task itself — only while it isn't live work yet.
  if (
    body.title !== undefined ||
    body.description !== undefined ||
    body.weight !== undefined ||
    body.teamId !== undefined ||
    body.projectId !== undefined
  ) {
    if (String(task.approvalStatus) === "APPROVED") {
      throw new Error("APPROVED_CANNOT_EDIT");
    }

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) throw new Error("TITLE_REQUIRED");
      if (title.length > 200) throw new Error("TITLE_TOO_LONG");
      data.title = title;
    }
    if (body.description !== undefined) {
      data.description = body.description
        ? String(body.description).trim().slice(0, 2000)
        : null;
    }
    if (body.weight !== undefined) {
      const weight = String(body.weight);
      if (!WEIGHTS.includes(weight)) throw new Error("BAD_WEIGHT");
      data.weight = weight as never;
    }
    if (body.teamId !== undefined || body.projectId !== undefined) {
      data.teamId = await resolveProject(
        userId,
        body.teamId ?? body.projectId ?? null
      );
    }

    // A sent-back task that gets edited goes straight back for approval.
    if (String(task.approvalStatus) === "REJECTED") {
      data.approvalStatus = "PENDING" as never;
      data.rejectionNote = null;
      data.approvedById = null;
      data.approvedAt = null;
    }
  }

  if (Object.keys(data).length === 0) throw new Error("NOTHING_TO_UPDATE");

  await prisma.dailyTask.update({
    where: { id: taskId },
    data: data as never,
  });

  return listTasks(userId);
}

export async function deleteMyTask(userId: string, taskId: string) {
  const task = await prisma.dailyTask.findUnique({ where: { id: taskId } });
  if (!task || task.userId !== userId) throw new Error("NOT_FOUND");

  if (task.assignedById) throw new Error("ASSIGNED_CANNOT_DELETE");
  if (task.outcome) throw new Error("ALREADY_REVIEWED");
  if (
    String(task.approvalStatus) === "APPROVED" &&
    String(task.status) !== "PENDING"
  ) {
    throw new Error("ALREADY_STARTED");
  }

  await prisma.dailyTask.delete({ where: { id: taskId } });
  return listTasks(userId);
}

// ---------------------------------------------------------------------------
// MANAGER SIDE
// ---------------------------------------------------------------------------
export async function listForApproval(managerId: string) {
  const ctx = await userContext(managerId);
  if (!MANAGING_ROLES.includes(ctx.role)) throw new Error("NOT_ALLOWED");

  const actor = { id: managerId, role: ctx.role, platformId: ctx.platformId };
  const date = platformToday(ctx.timezone);
  const dateStr = date.toISOString().slice(0, 10);

  const userIds = await manageableUserIds(actor);
  if (userIds.length === 0) {
    return {
      date: dateStr,
      teamSize: 0,
      members: [],
      people: [],
      team: [],
      projects: [],
      proposals: [],
      awaitingApproval: [],
      toReview: [],
      grading: [],
      toGrade: [],
      recent: [],
      all: [],
    };
  }

  const [people, rows, managedProjects] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        designation: true,
        platform: { select: { name: true } },
        teamMemberships: {
          where: { isActive: true },
          select: { team: { select: { id: true, name: true } } },
        },
      },
      orderBy: { firstName: "asc" },
    }),
    prisma.dailyTask.findMany({
      where: {
        userId: { in: userIds },
        // Today, plus anything still waiting on approval from an earlier day.
        // Filtering on today alone meant a task submitted at 6pm vanished
        // from the manager's queue at midnight, still pending and seen by
        // nobody. Bounded to 30 days so the queue cannot grow without limit.
        OR: [
          { date },
          {
            approvalStatus: "PENDING",
            date: {
              lt: date,
              gte: new Date(date.getTime() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        ],
      },
      include: {
        team: { select: { id: true, name: true } },
        user: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            platform: { select: { name: true } },
          },
        },
      },
      orderBy: { title: "asc" },
    }),
    prisma.team.findMany({
      where:
        ctx.role === "MANAGER"
          ? { managerId, isActive: true }
          : { platformId: ctx.platformId, isActive: true },
      select: { id: true, name: true, platform: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const all = rows.map((t) => {
    const who = `${t.user.firstName} ${t.user.lastName}`.trim();
    return {
      ...shape(t, t.team?.name ?? null),
      userId: t.userId,
      who,
      name: who,
      employee: who,
      employeeCode: t.user.employeeCode,
      company: t.user.platform?.name ?? null,
    };
  });

  const roster = people.map((p) => ({
    id: p.id,
    name: `${p.firstName} ${p.lastName}`.trim(),
    employeeCode: p.employeeCode,
    designation: p.designation,
    company: p.platform?.name ?? null,
    projects: p.teamMemberships.map((m) => m.team),
  }));

  const proposals = all.filter((t) => t.approvalStatus === "PENDING");
  const toReview = all.filter(
    (t) =>
      t.approvalStatus === "APPROVED" &&
      t.status === "COMPLETED" &&
      !t.outcome
  );
  const recent = all.filter(
    (t) => Boolean(t.outcome) || t.approvalStatus === "REJECTED"
  );

  return {
    date: dateStr,
    teamSize: roster.length,
    members: roster,
    people: roster,
    team: roster,
    // The project filter, and the dropdown when assigning work.
    projects: managedProjects.map((p) => ({
      id: p.id,
      name: p.name,
      company: p.platform?.name ?? null,
    })),
    proposals,
    awaitingApproval: proposals,
    toReview,
    grading: toReview,
    toGrade: toReview,
    recent,
    all,
  };
}

export async function assignTask(
  managerId: string,
  body: Record<string, unknown>
) {
  const ctx = await userContext(managerId);
  if (!MANAGING_ROLES.includes(ctx.role)) throw new Error("NOT_ALLOWED");
  const actor = { id: managerId, role: ctx.role, platformId: ctx.platformId };

  const targetUserId = String(body.userId ?? "");
  if (!targetUserId) throw new Error("USER_REQUIRED");
  await assertCanManage(actor, targetUserId);

  const title = String(body.title ?? "").trim();
  if (!title) throw new Error("TITLE_REQUIRED");
  if (title.length > 200) throw new Error("TITLE_TOO_LONG");

  const description = body.description
    ? String(body.description).trim().slice(0, 2000)
    : null;

  const weightIn = String(body.weight ?? "MEDIUM");
  const weight = WEIGHTS.includes(weightIn) ? weightIn : "MEDIUM";

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { platform: true },
  });
  if (!target) throw new Error("USER_NOT_FOUND");

  // Tagged to the employee's project, not the manager's guess.
  const teamId = await resolveProject(
    targetUserId,
    body.teamId ?? body.projectId ?? null
  );

  // The task lands on the EMPLOYEE's day, in their company's timezone.
  const date = platformToday(target.platform.timezone);

  await prisma.dailyTask.create({
    data: {
      platformId: target.platformId,
      userId: targetUserId,
      date,
      title,
      description,
      teamId,
      weight: weight as never,
      status: "PENDING" as never,
      // Assigned work needs no approval — the approver is the one assigning.
      approvalStatus: "APPROVED" as never,
      approvedById: managerId,
      approvedAt: new Date(),
      assignedById: managerId,
    },
  });

  return listForApproval(managerId);
}

export async function approveTask(
  managerId: string,
  taskId: string,
  approve: boolean,
  note?: string
) {
  const ctx = await userContext(managerId);
  if (!MANAGING_ROLES.includes(ctx.role)) throw new Error("NOT_ALLOWED");
  const actor = { id: managerId, role: ctx.role, platformId: ctx.platformId };

  const task = await prisma.dailyTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("NOT_FOUND");
  await assertCanReviewTask(actor, task);

  // A double-click can never overwrite a decision.
  if (String(task.approvalStatus) !== "PENDING") {
    throw new Error("ALREADY_ANSWERED");
  }

  await prisma.dailyTask.update({
    where: { id: taskId },
    data: {
      approvalStatus: (approve ? "APPROVED" : "REJECTED") as never,
      approvedById: managerId,
      approvedAt: new Date(),
      rejectionNote: approve
        ? null
        : note
        ? String(note).trim().slice(0, 1000)
        : null,
    },
  });

  return listForApproval(managerId);
}

export async function reviewTask(
  managerId: string,
  taskId: string,
  outcome: string,
  note?: string
) {
  const ctx = await userContext(managerId);
  if (!MANAGING_ROLES.includes(ctx.role)) throw new Error("NOT_ALLOWED");
  const actor = { id: managerId, role: ctx.role, platformId: ctx.platformId };

  const outcomeIn = String(outcome ?? "");
  if (!OUTCOMES.includes(outcomeIn)) throw new Error("BAD_OUTCOME");

  const task = await prisma.dailyTask.findUnique({ where: { id: taskId } });
  if (!task) throw new Error("NOT_FOUND");
  await assertCanReviewTask(actor, task);

  if (String(task.approvalStatus) !== "APPROVED") {
    throw new Error("NOT_APPROVED");
  }
  // A manager cannot fail something that was never finished.
  if (String(task.status) !== "COMPLETED") {
    throw new Error("NOT_FINISHED_YET");
  }

  await prisma.dailyTask.update({
    where: { id: taskId },
    data: {
      outcome: outcomeIn as never,
      reviewedById: managerId,
      reviewedAt: new Date(),
      reviewNote: note ? String(note).trim().slice(0, 1000) : null,
    },
  });

  return listForApproval(managerId);
}