// ===========================================================================
// GROUP HR
//
// The parent company's HR looks after joiners, onboarding documents,
// attendance corrections and leave for EVERY company. GROUP_HR_CODES in .env
// (employee codes, comma separated, e.g. "CP-03") decides who. It is separate
// from OWNER_CODES on purpose: an owner can also touch payroll and employee
// admin, group HR can only do these HR jobs.
//
// Unset = nobody is group HR and every HR stays inside their own company. A
// deployment pinned to one company (HRMS_COMPANY_SLUG) switches this off too.
// ===========================================================================

import "dotenv/config";
import { prisma } from "./prisma.js";
import { pinnedSlug } from "./deployment.js";

const codes = () =>
  String(process.env.GROUP_HR_CODES ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

export async function viewerIsGroupHr(viewerId: string): Promise<boolean> {
  if (pinnedSlug() || codes().length === 0) return false;
  const me = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { employeeCode: true, role: true, status: true },
  });
  if (!me || me.status !== "ACTIVE") return false;
  if (!["HR", "ADMIN"].includes(String(me.role))) return false;
  return codes().includes(String(me.employeeCode ?? "").toUpperCase());
}

// Active group-HR people in ANY company, so "new request" notices reach them too.
export async function groupHrUsers(excludeId?: string): Promise<{ id: string; email: string }[]> {
  if (pinnedSlug() || codes().length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { role: { in: ["HR", "ADMIN"] }, status: "ACTIVE", employeeCode: { in: codes(), mode: "insensitive" } },
    select: { id: true, email: true },
  });
  return rows.filter((r) => r.id !== excludeId);
}

// Prisma `where` fragment for "records this viewer may handle". Normal HR: their own
// company. Group HR: every company (no filter).
export async function companyScope(viewer: { id: string; platformId: string }): Promise<{ platformId?: string }> {
  return (await viewerIsGroupHr(viewer.id)) ? {} : { platformId: viewer.platformId };
}
