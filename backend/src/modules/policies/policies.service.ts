import { prisma } from "../../lib/prisma.js";
import { saveUpload, readStored, deleteStored, contentTypeFor } from "../../lib/storage.js";

// ---------------------------------------------------------------------------
// POLICIES & INDUCTION
//
// HR uploads company reading material (policies, induction decks). Everyone in
// the company (or in one team, if HR picked a team) can open it and confirm
// they have read it. The confirmation is a permanent record of WHO accepted
// WHICH VERSION and WHEN. Replacing the file bumps the version, so people have
// to accept the new one.
// ---------------------------------------------------------------------------

const STAFF = ["HR", "ADMIN"];
export const CATEGORIES = ["COMPANY_OVERVIEW", "PROBATION_POLICY", "LEAVE_POLICY", "CODE_OF_CONDUCT", "IT_POLICY", "ROLE_TRAINING", "OTHER"] as const;

async function who(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      platformId: true,
      teamMemberships: { where: { isActive: true }, select: { teamId: true } },
    },
  });
  if (!u) throw new Error("USER_NOT_FOUND");
  return { id: u.id, role: String(u.role), platformId: u.platformId, teamIds: u.teamMemberships.map((m) => m.teamId) };
}

async function staff(userId: string) {
  const v = await who(userId);
  if (!STAFF.includes(v.role)) throw new Error("NOT_ALLOWED");
  return v;
}

// A document is for the whole company, or for one team.
const visibleTo = (v: { platformId: string; teamIds: string[] }) => ({
  platformId: v.platformId,
  isActive: true,
  OR: [{ teamId: null }, { teamId: { in: v.teamIds } }],
});

// --- everyone ------------------------------------------------------------------

export async function listMine(userId: string) {
  const v = await who(userId);
  const docs = await prisma.inductionDocument.findMany({
    where: visibleTo(v),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const acks = await prisma.inductionAcknowledgement.findMany({
    where: { userId, inductionDocumentId: { in: docs.map((d) => d.id) } },
  });
  const key = (id: string, ver: number) => `${id}:${ver}`;
  const byKey = new Map(acks.map((a) => [key(a.inductionDocumentId, a.documentVersion), a]));
  const documents = docs.map((d) => {
    const a = byKey.get(key(d.id, d.version));
    return {
      id: d.id,
      category: String(d.category),
      title: d.title,
      description: d.description,
      isMandatory: d.isMandatory,
      version: d.version,
      fileName: d.fileName,
      opened: Boolean(a?.openedAt),
      acknowledgedAt: a?.acknowledgedAt ?? null,
    };
  });
  return { documents, pendingMandatory: documents.filter((d) => d.isMandatory && !d.acknowledgedAt).length };
}

async function findVisible(v: Awaited<ReturnType<typeof who>>, id: string) {
  // HR/Admin may open any document of their own company (including archived ones).
  const where = STAFF.includes(v.role) ? { id, platformId: v.platformId } : { id, ...visibleTo(v) };
  const doc = await prisma.inductionDocument.findFirst({ where });
  if (!doc) throw new Error("NOT_FOUND");
  return doc;
}

// Opening the file is what records "opened" for the current version.
export async function openFile(userId: string, id: string) {
  const v = await who(userId);
  const doc = await findVisible(v, id);
  await prisma.inductionAcknowledgement.upsert({
    where: { inductionDocumentId_userId_documentVersion: { inductionDocumentId: doc.id, userId, documentVersion: doc.version } },
    update: {},
    create: { inductionDocumentId: doc.id, userId, documentVersion: doc.version, openedAt: new Date() },
  });
  // The upsert's "update" is empty, so make sure an old row without openedAt gets one.
  await prisma.inductionAcknowledgement.updateMany({
    where: { inductionDocumentId: doc.id, userId, documentVersion: doc.version, openedAt: null },
    data: { openedAt: new Date() },
  });
  const buffer = await readStored(doc.storageKey);
  return { buffer, fileName: doc.fileName, mimeType: doc.mimeType ?? contentTypeFor(doc.storageKey) };
}

// You can only confirm a document you have opened, for the version that is current now.
export async function acknowledge(userId: string, id: string) {
  const v = await who(userId);
  const doc = await findVisible(v, id);
  if (!doc.isActive) throw new Error("NOT_FOUND");
  const res = await prisma.inductionAcknowledgement.updateMany({
    where: { inductionDocumentId: doc.id, userId, documentVersion: doc.version, openedAt: { not: null }, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  if (res.count === 0) {
    const existing = await prisma.inductionAcknowledgement.findUnique({
      where: { inductionDocumentId_userId_documentVersion: { inductionDocumentId: doc.id, userId, documentVersion: doc.version } },
    });
    if (existing?.acknowledgedAt) return { ok: true, already: true };
    throw new Error("OPEN_FIRST");
  }
  return { ok: true, already: false };
}

// --- HR / Admin ------------------------------------------------------------------

type Upload = { fileName?: string; data?: string; mimeType?: string };

async function store(platformId: string, f: Upload) {
  if (!f.data || !f.fileName) throw new Error("FILE_REQUIRED");
  return saveUpload({ platformId, folder: "induction", originalName: f.fileName, data: f.data, mimeType: f.mimeType });
}

export async function createDocument(
  viewerId: string,
  body: Upload & { category?: string; title?: string; description?: string; isMandatory?: boolean; teamId?: string | null }
) {
  const v = await staff(viewerId);
  const category = CATEGORIES.find((c) => c === body.category);
  if (!category) throw new Error("BAD_CATEGORY");
  const title = String(body.title ?? "").trim();
  if (title.length < 2) throw new Error("TITLE_REQUIRED");
  if (title.length > 120) throw new Error("TITLE_TOO_LONG");
  const description = String(body.description ?? "").trim().slice(0, 500) || null;

  let teamId: string | null = null;
  if (body.teamId) {
    const team = await prisma.team.findFirst({ where: { id: String(body.teamId), platformId: v.platformId }, select: { id: true } });
    if (!team) throw new Error("TEAM_NOT_FOUND");
    teamId = team.id;
  }

  const file = await store(v.platformId, body);
  const doc = await prisma.inductionDocument.create({
    data: {
      platformId: v.platformId,
      category,
      title,
      description,
      storageKey: file.storageKey,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      isMandatory: body.isMandatory !== false,
      teamId,
    },
  });
  return { id: doc.id };
}

export async function replaceFile(viewerId: string, id: string, body: Upload) {
  const v = await staff(viewerId);
  const doc = await prisma.inductionDocument.findFirst({ where: { id, platformId: v.platformId } });
  if (!doc) throw new Error("NOT_FOUND");
  const file = await store(v.platformId, body);
  await prisma.inductionDocument.update({
    where: { id },
    data: { storageKey: file.storageKey, fileName: file.fileName, fileSize: file.fileSize, mimeType: file.mimeType, version: { increment: 1 } },
  });
  // Old acknowledgements stay (they record the old version); only the file goes.
  await deleteStored(doc.storageKey);
  return { version: doc.version + 1 };
}

export async function setActive(viewerId: string, id: string, active: boolean) {
  const v = await staff(viewerId);
  const res = await prisma.inductionDocument.updateMany({ where: { id, platformId: v.platformId }, data: { isActive: active } });
  if (res.count === 0) throw new Error("NOT_FOUND");
  return { ok: true };
}

// Who is meant to read this document: the whole company, or the team it was limited to.
async function audience(platformId: string, teamId: string | null) {
  const people = await prisma.user.findMany({
    where: {
      platformId,
      status: { notIn: ["EXITED", "SUSPENDED"] },
      ...(teamId ? { teamMemberships: { some: { teamId, isActive: true } } } : {}),
    },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, designation: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return people;
}

export async function manageList(viewerId: string) {
  const v = await staff(viewerId);
  const [docs, teams] = await Promise.all([
    prisma.inductionDocument.findMany({ where: { platformId: v.platformId }, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] }),
    prisma.team.findMany({ where: { platformId: v.platformId, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const acks = await prisma.inductionAcknowledgement.findMany({
    where: { inductionDocumentId: { in: docs.map((d) => d.id) }, acknowledgedAt: { not: null } },
    select: { inductionDocumentId: true, documentVersion: true, userId: true },
  });
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  // Audience sizes: one query per distinct audience (company-wide, or each team), not per document.
  const sizes = new Map<string, number>();
  for (const key of new Set(docs.map((d) => d.teamId ?? "ALL"))) {
    sizes.set(key, (await audience(v.platformId, key === "ALL" ? null : key)).length);
  }
  return {
    teams,
    documents: docs.map((d) => ({
      id: d.id,
      category: String(d.category),
      title: d.title,
      description: d.description,
      isMandatory: d.isMandatory,
      isActive: d.isActive,
      version: d.version,
      fileName: d.fileName,
      team: d.teamId ? { id: d.teamId, name: teamName.get(d.teamId) ?? "Team" } : null,
      audience: sizes.get(d.teamId ?? "ALL") ?? 0,
      accepted: acks.filter((a) => a.inductionDocumentId === d.id && a.documentVersion === d.version).length,
    })),
  };
}

// The record an audit asks for: for the current version, who accepted and when, who has not.
export async function report(viewerId: string, id: string) {
  const v = await staff(viewerId);
  const doc = await prisma.inductionDocument.findFirst({ where: { id, platformId: v.platformId } });
  if (!doc) throw new Error("NOT_FOUND");
  const [people, acks] = await Promise.all([
    audience(v.platformId, doc.teamId),
    prisma.inductionAcknowledgement.findMany({ where: { inductionDocumentId: id, documentVersion: doc.version } }),
  ]);
  const byUser = new Map(acks.map((a) => [a.userId, a]));
  return {
    document: { id: doc.id, title: doc.title, version: doc.version },
    people: people.map((p) => {
      const a = byUser.get(p.id);
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        employeeCode: p.employeeCode,
        designation: p.designation,
        openedAt: a?.openedAt ?? null,
        acknowledgedAt: a?.acknowledgedAt ?? null,
      };
    }),
  };
}
