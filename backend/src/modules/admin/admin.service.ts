// ===========================================================================
// ADMIN â€” people, teams, shifts, thresholds, leave
//
// TENANCY
// Every function starts with actor(viewerId), which reads platformId off the
// viewer's own row. Nothing here ever accepts a platformId from the caller.
// That is why an Avatar admin cannot touch a Take Health user no matter what
// they put in the request body.
//
// ENUM VALUES
// The literal unions below are copied from prisma/schema/enums.prisma. They
// are not imported from the generated client on purpose â€” these arrays also
// drive validation and the UI dropdowns, so one list serves three jobs and
// TypeScript still rejects a value that isn't in the schema.
// ===========================================================================

import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { parseIsoDay } from "../../lib/dates.js";
import { viewerIsOwner } from "../../lib/owner.js";
import { getPinnedCompany } from "../../lib/deployment.js";
import { sendWelcome } from "../onboarding/onboarding.mail.js";
import { auditNote, changedFields } from "../../lib/auditContext.js";

export const USER_ROLES = ["EMPLOYEE", "MANAGER", "HR", "ADMIN"] as const;
export const USER_STATUSES = ["CANDIDATE", "INVITED", "ACTIVE", "SUSPENDED", "EXITED"] as const;
export const ONBOARDING_STATUSES = [
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "DOCUMENTS_PENDING",
  "DOCUMENTS_SUBMITTED",
  "AWAITING_RESUME",
  "ACTIVE",
] as const;
export const TEAM_TYPES = ["SALES", "SUPPORT", "TECH", "OPERATIONS", "OTHER"] as const;
export const LEAVE_TYPES = ["PLANNED", "CASUAL", "EARNED", "SICK", "COMP_OFF", "UNPAID", "OTHER"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export type TeamType = (typeof TEAM_TYPES)[number];
export type LeaveType = (typeof LEAVE_TYPES)[number];

const BCRYPT_COST = 10;

// --- shared helpers --------------------------------------------------------

async function actor(viewerId: string) {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: {
      id: true,
      role: true,
      platformId: true,
      platform: {
        select: {
          slug: true,
          employeeCodePrefix: true,
          defaultDailyWorkHours: true,
          defaultProductiveHours: true,
          defaultBreakBudgetMins: true,
        },
      },
    },
  });
  if (!viewer) throw new Error("NOT_FOUND");
  return viewer;
}

// Confirms the target row belongs to the viewer's platform before any write.
// Without this, a valid id from another tenant would be writable.
async function samePlatformUser(platformId: string, userId: string) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, platformId: true },
  });
  if (!target || target.platformId !== platformId) throw new Error("NOT_FOUND");
  return target;
}

function parseDay(value: string): Date {
  return parseIsoDay(value);
}

// Only an ADMIN may create, promote, demote, suspend or reset the password of an
// HR or Admin account. Without this an HR user could make themselves Admin.
const PRIVILEGED = ["HR", "ADMIN"];
function assertAdminForRole(viewerRole: string, role: unknown) {
  if (PRIVILEGED.includes(String(role)) && String(viewerRole) !== "ADMIN") throw new Error("ROLE_NOT_ALLOWED");
}
async function assertMayChangeAccount(viewer: { id: string; role: unknown }, userId: string) {
  if (String(viewer.role) === "ADMIN") return;
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (target && PRIVILEGED.includes(String(target.role)) && userId !== viewer.id) throw new Error("ROLE_NOT_ALLOWED");
}

function assertTime(value: string, field: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`BAD_TIME:${field}`);
}

// --- employee codes --------------------------------------------------------
// AVT-0005. The prefix is an explicit column so a brand-new platform with no
// users still produces correct codes. Reads the highest existing number and
// adds one; the unique constraint on (platformId, employeeCode) is the real
// guarantee if two admins ever create someone at the same instant.
async function nextEmployeeCode(platformId: string, prefix: string | null, slug: string) {
  const mark = (prefix ?? slug.slice(0, 3)).toUpperCase();

  const existing = await prisma.user.findMany({
    where: { platformId, employeeCode: { startsWith: `${mark}-` } },
    select: { employeeCode: true },
  });

  let highest = 0;
  for (const row of existing) {
    const n = Number(row.employeeCode?.split("-")[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  return `${mark}-${String(highest + 1).padStart(4, "0")}`;
}

// ===========================================================================
// PEOPLE
// ===========================================================================

export async function listUsers(
  viewerId: string,
  filters: { search?: string; role?: string; status?: string } = {}
) {
  const viewer = await actor(viewerId);

  const search = filters.search?.trim();
  const role = USER_ROLES.find((r) => r === filters.role);
  const status = USER_STATUSES.find((s) => s === filters.status);

  // An owner runs every company, so the list must not stop at their own -
  // otherwise someone they just created into Aayush simply vanishes.
  const owner = await viewerIsOwner(viewerId);

  const users = await prisma.user.findMany({
    where: {
      ...(owner ? {} : { platformId: viewer.platformId }),
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { employeeCode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      employeeCode: true,
      role: true,
      status: true,
      designation: true,
      dateOfJoining: true,
      onboardingStatus: true,
      trackerAccessEnabled: true,
      lastLoginAt: true,
            shift: { select: { id: true, name: true } },
      reportsTo: { select: { id: true, firstName: true, lastName: true } },
      platform: { select: { name: true } },
      teamMemberships: {
        where: { isActive: true },
        select: { team: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ firstName: "asc" }],
  });

  return users.map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName}`.trim(),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    employeeCode: u.employeeCode,
    role: u.role,
    status: u.status,
    designation: u.designation,
    dateOfJoining: u.dateOfJoining,
    onboardingStatus: u.onboardingStatus,
    trackerAccessEnabled: u.trackerAccessEnabled,
    lastLoginAt: u.lastLoginAt,
        shift: u.shift,
    reportsTo: u.reportsTo
      ? {
          id: u.reportsTo.id,
          name: `${u.reportsTo.firstName} ${u.reportsTo.lastName}`.trim(),
        }
      : null,
    teams: u.teamMemberships.map((m) => m.team),
    company: u.platform?.name ?? null,
  }));
}

export async function createUser(
  viewerId: string,
  data: {
    email: string;
    firstName: string;
    lastName: string;
    password: string;
    role?: string;
    designation?: string;
    phone?: string;
    employeeCode?: string;
        shiftId?: string;
    teamId?: string;
    reportsToId?: string;
    dateOfJoining?: string;
    skipOnboarding?: boolean;
  }
) {
  const viewer = await actor(viewerId);

  const email = data.email?.trim().toLowerCase();
  if (!email || !data.firstName?.trim() || !data.lastName?.trim()) {
    throw new Error("MISSING_FIELDS");
  }
  if (!data.password || data.password.length < 8) throw new Error("WEAK_PASSWORD");

  const role = USER_ROLES.find((r) => r === data.role) ?? "EMPLOYEE";
  assertAdminForRole(viewer.role, role);

  // Uniqueness is per platform, not global â€” the same person can legitimately
  // exist in Avatar and in Take Health with the same address.
  // An owner may create people into any company, and the TEAM decides which
  // one. Creating a TC Software person onto an Aayush team would leave every
  // report disagreeing with every other. With no team, it is the viewer's own
  // company, exactly as before.
  const owner = await viewerIsOwner(viewerId);

  let targetPlatformId = viewer.platformId;
  let codePrefix: string | null = viewer.platform.employeeCodePrefix;
  let codeSlug: string = viewer.platform.slug;

  if (data.teamId) {
    const chosenTeam = await prisma.team.findUnique({
      where: { id: data.teamId },
      select: {
        platformId: true,
        platform: { select: { employeeCodePrefix: true, slug: true } },
      },
    });
    if (!chosenTeam) throw new Error("TEAM_NOT_FOUND");
    if (!owner && chosenTeam.platformId !== viewer.platformId) {
      throw new Error("TEAM_NOT_FOUND");
    }
    targetPlatformId = chosenTeam.platformId;
    codePrefix = chosenTeam.platform?.employeeCodePrefix ?? null;
    codeSlug = chosenTeam.platform?.slug ?? viewer.platform.slug;
  }

  const clash = await prisma.user.findFirst({
    where: { platformId: targetPlatformId, email },
    select: { id: true },
  });
  if (clash) throw new Error("EMAIL_TAKEN");

  // The code follows the company the person is actually joining, so somebody
  // added to Aayush gets an Aayush code and not a TC Software one.
  const employeeCode =
    data.employeeCode?.trim() ||
    (await nextEmployeeCode(targetPlatformId, codePrefix, codeSlug));

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);

  // skipOnboarding is the "they already work here" path â€” HR creating an
  // existing employee rather than a new joiner. It opens the tracker gate
  // immediately instead of waiting for documents and a resume.
  const skip = data.skipOnboarding === true;

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        platformId: targetPlatformId,
        email,
        passwordHash,
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        phone: data.phone?.trim() || null,
        employeeCode,
        role,
        status: "INVITED",
        designation: data.designation?.trim() || null,
        dateOfJoining: data.dateOfJoining ? parseDay(data.dateOfJoining) : null,
        shiftId: data.shiftId || null,
        reportsToId: data.reportsToId || null,
        onboardingStatus: skip ? "ACTIVE" : "OFFER_SENT",
        trackerAccessEnabled: true,
        accessGrantedAt: new Date(),
        // Whoever typed this password - HR, an admin, or the generator - it is
        // known to someone other than its owner, so it works exactly once.
        mustChangePassword: true,


      },
      select: { id: true, email: true, employeeCode: true },
    });

    if (data.teamId) {
      const team = await tx.team.findUnique({
        where: { id: data.teamId },
        select: { platformId: true },
      });
      if (!team || team.platformId !== targetPlatformId) throw new Error("TEAM_NOT_FOUND");

      await tx.teamMember.create({ data: { teamId: data.teamId, userId: user.id } });
    }

    return user;
  });

  // A new joiner is useless without their login. Creating someone here must
  // send the same welcome email the Joiners screen sends - otherwise they are
  // chasing HR for a password that only ever existed in a form field.
  // Existing employees skip it: that email is about documents they do not owe.
  const mail = skip ? null : await sendWelcome(created.id, data.password);

  auditNote({
    module: "Employees",
    action: "CREATE",
    recordType: "User",
    recordId: created.id,
    targetUserId: created.id,
    summary: `Created an account for ${data.firstName?.trim()} ${data.lastName?.trim()} as ${role}`,
    after: { name: `${data.firstName?.trim()} ${data.lastName?.trim()}`.trim(), email, role, employeeCode: (created as { employeeCode?: string | null }).employeeCode ?? null },
  });
  return { ...created, mail };
}

export async function updateUser(
  viewerId: string,
  userId: string,
  data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    role?: string;
    status?: string;
    designation?: string;
    employeeCode?: string;
        shiftId?: string | null;
    reportsToId?: string | null;
    dateOfJoining?: string | null;
    onboardingStatus?: string;
    trackerAccessEnabled?: boolean;
    biometricId?: string | null;
  }
) {
  const viewer = await actor(viewerId);
  await samePlatformUser(viewer.platformId, userId);
  await assertMayChangeAccount(viewer, userId);

  const role = USER_ROLES.find((r) => r === data.role);
  assertAdminForRole(viewer.role, role);
  // Even on their own record, a non-admin cannot change their own role, status or access.
  if (String(viewer.role) !== "ADMIN" && userId === viewer.id && (role || data.status !== undefined || data.trackerAccessEnabled !== undefined)) {
    throw new Error("ROLE_NOT_ALLOWED");
  }
  const status = USER_STATUSES.find((s) => s === data.status);
  const onboardingStatus = ONBOARDING_STATUSES.find((s) => s === data.onboardingStatus);

  // The audit trail records what each changed field WAS and what it became.
  const AUDIT_KEYS = ["firstName", "lastName", "phone", "role", "status", "designation", "employeeCode", "shiftId", "reportsToId", "biometricId", "dateOfJoining", "onboardingStatus", "trackerAccessEnabled"];
  const pick = { firstName: true, lastName: true, phone: true, role: true, status: true, designation: true, employeeCode: true, shiftId: true, reportsToId: true, biometricId: true, dateOfJoining: true, onboardingStatus: true, trackerAccessEnabled: true } as const;
  const beforeRow = await prisma.user.findUnique({ where: { id: userId }, select: pick });

  // Opening the gate stamps when it happened; closing it clears the stamp.
  const gate =
    data.trackerAccessEnabled === undefined
      ? {}
      : {
          trackerAccessEnabled: data.trackerAccessEnabled,
          accessGrantedAt: data.trackerAccessEnabled ? new Date() : null,
        };

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.firstName !== undefined ? { firstName: data.firstName.trim() } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName.trim() } : {}),
      ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
      ...(role ? { role } : {}),
      ...(status ? { status, ...(status === "EXITED" ? { exitDate: new Date() } : {}) } : {}),
      ...(data.designation !== undefined
        ? { designation: data.designation?.trim() || null }
        : {}),
      ...(data.employeeCode !== undefined
        ? { employeeCode: data.employeeCode?.trim() || null }
        : {}),
      ...(data.shiftId !== undefined ? { shiftId: data.shiftId || null } : {}),
      ...(data.reportsToId !== undefined
        ? { reportsToId: data.reportsToId || null }
        : {}),
      ...(data.biometricId !== undefined
      ? { biometricId: data.biometricId?.trim() || null }
      : {}),
      ...(data.dateOfJoining !== undefined
        ? { dateOfJoining: data.dateOfJoining ? parseDay(data.dateOfJoining) : null }
        : {}),
      ...(onboardingStatus ? { onboardingStatus } : {}),
      ...gate,
    },
    select: { id: true },
  });

  const afterRow = await prisma.user.findUnique({ where: { id: userId }, select: pick });
  if (beforeRow && afterRow) {
    const diff = changedFields(beforeRow as never, afterRow as never, AUDIT_KEYS);
    // Role, status and tracker access decide what a person can do: those are permission changes.
    const permission = ["role", "status", "trackerAccessEnabled"].some((k) => k in (diff.after as Record<string, unknown>));
    const names = Object.keys(diff.after as Record<string, unknown>);
    auditNote({
      module: "Employees",
      action: permission ? "PERMISSION" : "UPDATE",
      recordType: "User",
      recordId: userId,
      targetUserId: userId,
      before: diff.before,
      after: diff.after,
      summary: names.length ? (permission ? "Changed access: " : "Updated: ") + names.join(", ") : "Saved with no changes",
    });
  }
  return updatedUser;
}

export async function resetPassword(viewerId: string, userId: string, password: string) {
  const viewer = await actor(viewerId);
  await samePlatformUser(viewer.platformId, userId);
  await assertMayChangeAccount(viewer, userId);
  if (!password || password.length < 8) throw new Error("WEAK_PASSWORD");

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  auditNote({ module: "Employees", action: "PASSWORD", recordType: "User", recordId: userId, targetUserId: userId, summary: "Password reset by HR/Admin (the password itself is never recorded)" });
  return { ok: true };
}

// ===========================================================================
// TEAMS
// ===========================================================================

export async function listTeams(viewerId: string) {
  const viewer = await actor(viewerId);

  const teams = await prisma.team.findMany({
    where: { platformId: viewer.platformId },
    select: {
      id: true,
      name: true,
      teamType: true,
      isActive: true,
      manager: { select: { id: true, firstName: true, lastName: true } },
      shift: { select: { id: true, name: true, startTime: true, endTime: true } },
      config: true,
      members: {
        where: { isActive: true },
        select: {
          userId: true,
          user: { select: { firstName: true, lastName: true, employeeCode: true, role: true } },
        },
      },
    },
    orderBy: [{ name: "asc" }],
  });

  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    teamType: t.teamType,
    isActive: t.isActive,
    manager: t.manager
      ? { id: t.manager.id, name: `${t.manager.firstName} ${t.manager.lastName}`.trim() }
      : null,
    shift: t.shift,
    config: t.config,
    memberCount: t.members.length,
    members: t.members.map((m) => ({
      userId: m.userId,
      name: `${m.user.firstName} ${m.user.lastName}`.trim(),
      employeeCode: m.user.employeeCode,
      role: m.user.role,
    })),
  }));
}

export async function createTeam(
  viewerId: string,
  data: { name: string; teamType?: string; managerId?: string; shiftId?: string }
) {
  const viewer = await actor(viewerId);
  if (!data.name?.trim()) throw new Error("MISSING_FIELDS");

  const teamType = TEAM_TYPES.find((t) => t === data.teamType) ?? "OTHER";

  // A team without thresholds would make every alert fall back to a hardcoded
  // default, which is the thing we promised never to do. Config is created in
  // the same transaction, seeded from the platform's defaults.
  const created = await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: {
        platformId: viewer.platformId,
        name: data.name.trim(),
        teamType,
        managerId: data.managerId || null,
        shiftId: data.shiftId || null,
      },
      select: { id: true, name: true },
    });

    await tx.teamConfig.create({
      data: {
        teamId: team.id,
        dailyWorkHours: viewer.platform.defaultDailyWorkHours,
        productiveHours: viewer.platform.defaultProductiveHours,
        breakBudgetMinutes: viewer.platform.defaultBreakBudgetMins,
      },
    });

    return team;
  });

  return created;
}

export async function updateTeam(
  viewerId: string,
  teamId: string,
  data: {
    name?: string;
    teamType?: string;
    managerId?: string | null;
    shiftId?: string | null;
    isActive?: boolean;
  }
) {
  const viewer = await actor(viewerId);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { platformId: true },
  });
  if (!team || team.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  const teamType = TEAM_TYPES.find((t) => t === data.teamType);

  return prisma.team.update({
    where: { id: teamId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(teamType ? { teamType } : {}),
      ...(data.managerId !== undefined ? { managerId: data.managerId || null } : {}),
      ...(data.shiftId !== undefined ? { shiftId: data.shiftId || null } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
    select: { id: true },
  });
}

export async function addTeamMember(viewerId: string, teamId: string, userId: string) {
  const viewer = await actor(viewerId);
  const owner = await viewerIsOwner(viewerId);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { platformId: true },
  });
  if (!team) throw new Error("NOT_FOUND");
  if (!owner && team.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  // An owner may reach across companies; nobody may mix them. The person and
  // the team must belong to the same one.
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { platformId: true },
  });
  if (!target || target.platformId !== team.platformId) throw new Error("NOT_FOUND");

  // Upsert, not create â€” re-adding someone who previously left should
  // reactivate their row rather than fail on the unique constraint.
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId } },
    update: { isActive: true, leftAt: null },
    create: { teamId, userId },
  });

  return { ok: true };
}

export async function removeTeamMember(viewerId: string, teamId: string, userId: string) {
  const viewer = await actor(viewerId);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { platformId: true },
  });
  if (!team || team.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { teamId: true },
  });
  if (!membership) throw new Error("NOT_FOUND");

  // Soft removal. Deleting the row would orphan the history of who was in
  // which team when a past report was produced.
  await prisma.teamMember.update({
    where: { teamId_userId: { teamId, userId } },
    data: { isActive: false, leftAt: new Date() },
  });

  return { ok: true };
}

// ===========================================================================
// SHIFTS
// ===========================================================================

export async function listShifts(viewerId: string) {
  const viewer = await actor(viewerId);
  return prisma.shift.findMany({
    where: { platformId: viewer.platformId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function createShift(
  viewerId: string,
  data: {
    name: string;
    startTime: string;
    endTime: string;
    workingDays?: number[];
    isDefault?: boolean;
    spansMidnight?: boolean;
  }
) {
  const viewer = await actor(viewerId);
  if (!data.name?.trim()) throw new Error("MISSING_FIELDS");
  assertTime(data.startTime, "startTime");
  assertTime(data.endTime, "endTime");

  const workingDays = normaliseWorkingDays(data.workingDays);

  const created = await prisma.$transaction(async (tx) => {
    // Exactly one default per platform, enforced here rather than hoped for.
    if (data.isDefault) {
      await tx.shift.updateMany({
        where: { platformId: viewer.platformId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.shift.create({
      data: {
        platformId: viewer.platformId,
        name: data.name.trim(),
        startTime: data.startTime,
        endTime: data.endTime,
        workingDays,
        isDefault: data.isDefault === true,
        spansMidnight: data.spansMidnight === true,
      },
      select: { id: true, name: true },
    });
  });
}

export async function updateShift(
  viewerId: string,
  shiftId: string,
  data: {
    name?: string;
    startTime?: string;
    endTime?: string;
    workingDays?: number[];
    isDefault?: boolean;
    isActive?: boolean;
    spansMidnight?: boolean;
  }
) {
  const viewer = await actor(viewerId);

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    select: { platformId: true },
  });
  if (!shift || shift.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  if (data.startTime) assertTime(data.startTime, "startTime");
  if (data.endTime) assertTime(data.endTime, "endTime");

  const created = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.shift.updateMany({
        where: { platformId: viewer.platformId, isDefault: true, id: { not: shiftId } },
        data: { isDefault: false },
      });
    }

    return tx.shift.update({
      where: { id: shiftId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.startTime ? { startTime: data.startTime } : {}),
        ...(data.endTime ? { endTime: data.endTime } : {}),
        ...(data.workingDays ? { workingDays: normaliseWorkingDays(data.workingDays) } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.spansMidnight !== undefined ? { spansMidnight: data.spansMidnight } : {}),
      },
      select: { id: true },
    });
  });
}

// Mon..Sun as 1..7, deduped and sorted. A shift with no working days would
// make every single day an absence, so that is rejected outright.
function normaliseWorkingDays(days?: number[]): number[] {
  const clean = Array.from(new Set((days ?? [1, 2, 3, 4, 5, 6]).map(Number)))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b);
  if (clean.length === 0) throw new Error("NO_WORKING_DAYS");
  return clean;
}

// ===========================================================================
// THRESHOLDS
// ===========================================================================

export async function updateTeamConfig(
  viewerId: string,
  teamId: string,
  data: Record<string, unknown>
) {
  const viewer = await actor(viewerId);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { platformId: true },
  });
  if (!team || team.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  const num = (key: string) => {
    const v = data[key];
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`BAD_NUMBER:${key}`);
    return n;
  };

  const threshold = num("lowProductivityThreshold");
  if (threshold !== undefined && threshold > 1) {
    throw new Error("BAD_NUMBER:lowProductivityThreshold");
  }

  const eod = data.eodReportTime;
  if (typeof eod === "string" && eod) assertTime(eod, "eodReportTime");

  const payload: Record<string, unknown> = {
    dailyWorkHours: num("dailyWorkHours"),
    productiveHours: num("productiveHours"),
    breakBudgetMinutes: num("breakBudgetMinutes"),
    lateLoginGraceMinutes: num("lateLoginGraceMinutes"),
    breakOverageAlertMinutes: num("breakOverageAlertMinutes"),
    overtimeAlertMinutes: num("overtimeAlertMinutes"),
    lowProductivityThreshold: threshold,
    biometricToleranceMinutes: num("biometricToleranceMinutes"),
    ...(typeof eod === "string" && eod ? { eodReportTime: eod } : {}),
    ...(typeof data.notifyByEmail === "boolean" ? { notifyByEmail: data.notifyByEmail } : {}),
    ...(typeof data.notifyByWhatsapp === "boolean"
      ? { notifyByWhatsapp: data.notifyByWhatsapp }
      : {}),
  };

  const clean: Record<string, unknown> = Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined)
  );

  // Integer columns must not receive 8.5 â€” Postgres would reject it.
  for (const key of [
    "breakBudgetMinutes",
    "lateLoginGraceMinutes",
    "breakOverageAlertMinutes",
    "overtimeAlertMinutes",
    "biometricToleranceMinutes",
  ]) {
    if (clean[key] !== undefined) clean[key] = Math.round(Number(clean[key]));
  }

  // Nothing is recalculated here. The scheduler's next pass reads these
  // numbers and regenerates alerts via upsert, so a change takes effect
  // within fifteen minutes with no restart.
  return prisma.teamConfig.upsert({
    where: { teamId },
    update: clean,
    create: { teamId, ...clean },
  });
}

// ===========================================================================
// LEAVE
// ===========================================================================

export async function listLeave(viewerId: string, fromStr: string, toStr: string) {
  const viewer = await actor(viewerId);
  const from = parseDay(fromStr);
  const to = parseDay(toStr);

  const rows = await prisma.leaveDay.findMany({
    where: { platformId: viewer.platformId, date: { gte: from, lte: to } },
    select: {
      id: true,
      date: true,
      leaveType: true,
      isHalfDay: true,
      isFirstHalf: true,
      note: true,
      user: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
      markedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ date: "desc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    leaveType: r.leaveType,
    isHalfDay: r.isHalfDay,
    isFirstHalf: r.isFirstHalf,
    note: r.note,
    userId: r.user.id,
    name: `${r.user.firstName} ${r.user.lastName}`.trim(),
    employeeCode: r.user.employeeCode,
    markedBy: `${r.markedBy.firstName} ${r.markedBy.lastName}`.trim(),
  }));
}

export async function markLeave(
  viewerId: string,
  data: {
    userId: string;
    from: string;
    to?: string;
    leaveType?: string;
    isHalfDay?: boolean;
    isFirstHalf?: boolean;
    note?: string;
  }
) {
  const viewer = await actor(viewerId);
  await samePlatformUser(viewer.platformId, data.userId);

  const from = parseDay(data.from);
  const to = data.to ? parseDay(data.to) : from;
  if (to.getTime() < from.getTime()) throw new Error("BAD_RANGE");

  const spanDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  if (spanDays > 120) throw new Error("RANGE_TOO_LONG");

  const leaveType = LEAVE_TYPES.find((t) => t === data.leaveType) ?? "PLANNED";

  // One row per calendar day. Reports then join on a date instead of doing
  // range arithmetic on every query â€” and the unique constraint on
  // (userId, date) makes marking the same day twice harmless.
  const days: Date[] = [];
  for (let i = 0; i < spanDays; i++) {
    days.push(new Date(from.getTime() + i * 86400000));
  }

  await prisma.$transaction(
    days.map((date) =>
      prisma.leaveDay.upsert({
        where: { userId_date: { userId: data.userId, date } },
        update: {
          leaveType,
          isHalfDay: data.isHalfDay === true,
          isFirstHalf: data.isFirstHalf !== false,
          note: data.note?.trim() || null,
          markedById: viewer.id,
        },
        create: {
          platformId: viewer.platformId,
          userId: data.userId,
          date,
          leaveType,
          isHalfDay: data.isHalfDay === true,
          isFirstHalf: data.isFirstHalf !== false,
          note: data.note?.trim() || null,
          markedById: viewer.id,
        },
      })
    )
  );

  return { marked: days.length };
}

export async function unmarkLeave(viewerId: string, userId: string, dateStr: string) {
  const viewer = await actor(viewerId);
  await samePlatformUser(viewer.platformId, userId);

  await prisma.leaveDay.deleteMany({
    where: { userId, date: parseDay(dateStr) },
  });

  return { ok: true };
}

// ===========================================================================
// One call to populate every dropdown on the Admin screen, so the page does
// not fire five requests before it can render a form.
// ===========================================================================

// ---------------------------------------------------------------------------
// OWNER ACCESS
//
// Ranjan runs all ten companies, so he needs to see across them. A customer's
// admin must not. Rather than a new role - which would mean a migration plus
// auditing every ["HR","ADMIN"] check in the codebase, where one miss locks
// someone out - this is driven by an environment setting. A customer's
// installation never sets OWNER_CODES, so their admin stays scoped exactly as
// before. Turning it off here is deleting one line from .env.
// ---------------------------------------------------------------------------


export async function getAdminOptions(viewerId: string) {
  const viewer = await actor(viewerId);
  const owner = await viewerIsOwner(viewerId);
  const pinned = await getPinnedCompany();

  // Only an owner sees other companies' teams.
  const teamScope = owner ? {} : { platformId: viewer.platformId };

  const [teams, leads, shifts] = await Promise.all([
    prisma.team.findMany({
      where: { ...teamScope, isActive: true },
      select: { id: true, name: true, platform: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),

    // Who may appear in any "reports to" or "manager" dropdown.
    //
    // MANAGER and ADMIN only. HR administers people, it does not approve
    // their work, and an ordinary employee approving tasks defeats the point
    // of approval. Deliberately NOT scoped to one company: a manager here
    // genuinely runs teams across several, which is how Avatar operates.
    prisma.user.findMany({
      where: {
        role: { in: ["MANAGER", "ADMIN"] },
        status: { not: "EXITED" },
        // A deployment pinned to one company offers only that company's managers.
        ...(pinned ? { platformId: pinned.id } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        role: true,
        platform: { select: { name: true } },
      },
      orderBy: [{ role: "asc" }, { firstName: "asc" }],
    }),

    // Shifts stay scoped to the viewer's own company even for an owner -
    // putting someone on another company's shift would silently break their
    // late-login measurement.
    prisma.shift.findMany({
      where: { platformId: viewer.platformId, isActive: true },
      select: { id: true, name: true, startTime: true, endTime: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
  ]);

  const asOption = (p: (typeof leads)[number]) => ({
    id: p.id,
    name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    employeeCode: p.employeeCode,
    role: p.role,
    company: p.platform?.name ?? null,
  });

  return {
    // An owner sees several companies at once, so the company is part of the
    // label. Inside one company that prefix is just noise.
    teams: teams.map((t) => ({
      id: t.id,
      name: owner && t.platform?.name ? `${t.platform.name} - ${t.name}` : t.name,
    })),
    shifts,
    // Both keys carry the same list so every dropdown reading either one gets
    // the same rule, rather than two lists drifting apart.
    managers: leads.map(asOption),
    people: leads.map(asOption),
    isOwner: owner,
    roles: String(viewer.role) === "ADMIN" ? USER_ROLES : USER_ROLES.filter((r) => !PRIVILEGED.includes(r)),
    statuses: USER_STATUSES,
    onboardingStatuses: ONBOARDING_STATUSES,
    teamTypes: TEAM_TYPES,
    leaveTypes: LEAVE_TYPES,
  };
}
