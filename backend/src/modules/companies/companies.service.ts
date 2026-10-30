import { prisma } from "../../lib/prisma.js";
import { getPinnedCompany } from "../../lib/deployment.js";
import { auditNote, changedFields } from "../../lib/auditContext.js";

// ---------------------------------------------------------------------------
// COMPANY MANAGEMENT (HR and Admin only; the routes enforce the role)
//
// A company is a row in `platforms`. This only manages the company record
// itself (name, legal name, timezone, employee-code prefix, active or not).
//   - Everyone with HR/Admin can see the list of company names.
//   - Employee numbers and details are only shown for the viewer's OWN company.
//   - HR can edit their own company; Admin can edit any company.
//   - Nobody can deactivate their own company, or the one this deployment is
//     pinned to, because that would lock them out.
// ---------------------------------------------------------------------------

async function who(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, platformId: true } });
  if (!u) throw new Error("USER_NOT_FOUND");
  const role = String(u.role);
  if (role !== "HR" && role !== "ADMIN") throw new Error("NOT_ALLOWED");
  return { id: u.id, role, platformId: u.platformId };
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function checkTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new Error("BAD_TIMEZONE");
  }
}

function cleanPrefix(v: unknown) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (!/^[A-Z0-9]{2,8}$/.test(s)) throw new Error("BAD_PREFIX");
  return s;
}

export async function listCompanies(viewerId: string) {
  const v = await who(viewerId);
  const [rows, pinned, counts] = await Promise.all([
    prisma.platform.findMany({ orderBy: { name: "asc" } }),
    getPinnedCompany(),
    prisma.user.count({ where: { platformId: v.platformId, status: { not: "EXITED" } } }),
  ]);
  return {
    pinnedTo: pinned ? { id: pinned.id, name: pinned.name } : null,
    canCreate: true,
    companies: rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      legalName: c.legalName,
      timezone: c.timezone,
      employeeCodePrefix: c.employeeCodePrefix,
      isActive: c.isActive,
      isYours: c.id === v.platformId,
      isPinned: pinned?.id === c.id,
      // Employee numbers belong to the viewer's own company only.
      employees: c.id === v.platformId ? counts : null,
      canEdit: v.role === "ADMIN" || c.id === v.platformId,
    })),
  };
}

type Body = { name?: string; legalName?: string | null; timezone?: string; employeeCodePrefix?: string | null; isActive?: boolean };

export async function createCompany(viewerId: string, body: Body) {
  await who(viewerId);
  const name = String(body.name ?? "").trim();
  if (name.length < 2) throw new Error("NAME_REQUIRED");
  if (name.length > 80) throw new Error("NAME_TOO_LONG");

  const slug = slugify(name);
  if (!slug) throw new Error("NAME_REQUIRED");
  const clash = await prisma.platform.findFirst({ where: { OR: [{ slug }, { name: { equals: name, mode: "insensitive" } }] }, select: { id: true } });
  if (clash) throw new Error("COMPANY_EXISTS");

  const created = await prisma.platform.create({
    data: {
      name,
      slug,
      legalName: String(body.legalName ?? "").trim() || null,
      timezone: checkTimezone(String(body.timezone ?? "Asia/Kolkata")),
      employeeCodePrefix: cleanPrefix(body.employeeCodePrefix),
    },
  });
  return { id: created.id, slug: created.slug };
}

export async function updateCompany(viewerId: string, id: string, body: Body) {
  const v = await who(viewerId);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("NOT_FOUND");
  const company = await prisma.platform.findUnique({ where: { id } });
  if (!company) throw new Error("NOT_FOUND");
  // HR may only touch their own company. Admin may edit any.
  if (v.role !== "ADMIN" && company.id !== v.platformId) throw new Error("NOT_YOUR_COMPANY");

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) throw new Error("NAME_REQUIRED");
    if (name.length > 80) throw new Error("NAME_TOO_LONG");
    const clash = await prisma.platform.findFirst({ where: { id: { not: id }, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (clash) throw new Error("COMPANY_EXISTS");
    data.name = name; // the slug stays fixed: it is how a deployment is pinned
  }
  if (body.legalName !== undefined) data.legalName = String(body.legalName ?? "").trim() || null;
  if (body.timezone !== undefined) data.timezone = checkTimezone(String(body.timezone));
  if (body.employeeCodePrefix !== undefined) data.employeeCodePrefix = cleanPrefix(body.employeeCodePrefix);
  if (body.isActive !== undefined) {
    const pinned = await getPinnedCompany();
    if (body.isActive === false && (company.id === v.platformId || pinned?.id === company.id)) throw new Error("CANNOT_DEACTIVATE");
    data.isActive = body.isActive === true;
  }
  if (Object.keys(data).length === 0) throw new Error("NOTHING_TO_UPDATE");

  await prisma.platform.update({ where: { id }, data });
  const diff = changedFields(company as never, { ...company, ...data } as never, ["name", "legalName", "timezone", "employeeCodePrefix", "isActive"]);
  auditNote({ platformId: company.id, recordType: "Platform", recordId: company.id, before: diff.before, after: diff.after, summary: `Edited company ${company.name}: ${Object.keys(diff.after as Record<string, unknown>).join(", ") || "no changes"}` });
  return { ok: true };
}
