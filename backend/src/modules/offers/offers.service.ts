import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { sendMail } from "../../lib/mailer.js";
import { welcomeEmail } from "../../lib/emails.js";
import { parseIsoDay } from "../../lib/dates.js";

// ---------------------------------------------------------------------------
// OFFER LETTERS
//
// HR edits a template once, then every offer is that template with the
// candidate's details filled in. The rendered HTML is SNAPSHOTTED onto the
// offer, so editing the template later never changes a letter somebody has
// already accepted — which is the whole point of having a record.
// ---------------------------------------------------------------------------

const STAFF = ["HR", "ADMIN"];
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

async function staff(viewerId: string) {
  const user = await prisma.user.findUnique({
    where: { id: viewerId },
    include: { platform: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  if (!STAFF.includes(String(user.role))) throw new Error("NOT_ALLOWED");
  return user;
}

function tempPassword() {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(
    { length: 10 },
    () => a[Math.floor(Math.random() * a.length)]
  ).join("");
}

const dmy = (d: Date) =>
  d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const money = (n: unknown) =>
  n === null || n === undefined
    ? ""
    : `Rs ${Number(n).toLocaleString("en-IN")}`;

// The letter is written with {{placeholders}}. Anything unrecognised is left
// alone rather than blanked, so a typo in the template is visible to HR in
// the preview instead of silently vanishing from the letter.
function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, key) =>
    key in values ? values[key] : whole
  );
}

// ---------------------------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------------------------
const DEFAULT_BODY = `<p>Dear {{firstName}},</p>
<p>We are pleased to offer you the position of <strong>{{roleTitle}}</strong> at {{company}}.</p>
<p>Your joining date is <strong>{{joiningDate}}</strong>. You will report to {{reportingTo}}.</p>
<p>Your annual compensation will be {{ctc}}.</p>
<p>Please sign in to Avatar HRMS to accept this offer and upload the documents listed. Your employee ID is {{employeeCode}}.</p>
<p>We look forward to working with you.</p>
<p>Regards,<br/>{{company}}</p>`;

export async function listTemplates(viewerId: string) {
  const viewer = await staff(viewerId);

  const templates = await prisma.offerTemplate.findMany({
    where: { platformId: viewer.platformId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  // First time in, give HR something to edit rather than an empty screen.
  if (templates.length === 0) {
    const made = await prisma.offerTemplate.create({
      data: {
        platformId: viewer.platformId,
        name: "Standard offer",
        subject: "Your offer from {{company}} - {{roleTitle}}",
        bodyHtml: DEFAULT_BODY,
        emailIntro:
          "We're glad to have you joining us. Your offer and the documents we need are below.",
        isDefault: true,
      },
    });
    return {
      placeholders: PLACEHOLDERS,
      templates: [made],
    };
  }

  return { placeholders: PLACEHOLDERS, templates };
}

const PLACEHOLDERS = [
  "firstName",
  "lastName",
  "fullName",
  "roleTitle",
  "joiningDate",
  "ctc",
  "reportingTo",
  "company",
  "employeeCode",
  "today",
];

export async function saveTemplate(
  viewerId: string,
  body: Record<string, unknown>
) {
  const viewer = await staff(viewerId);

  const name = String(body.name ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const bodyHtml = String(body.bodyHtml ?? "").trim();
  if (!name || !subject || !bodyHtml) throw new Error("MISSING_FIELDS");

  const emailIntro = body.emailIntro ? String(body.emailIntro).trim() : null;
  const id = body.id ? String(body.id) : null;

  if (id) {
    const existing = await prisma.offerTemplate.findUnique({ where: { id } });
    if (!existing || existing.platformId !== viewer.platformId) {
      throw new Error("NOT_FOUND");
    }
    // version bumps so HR can see the letter was changed after an offer went
    // out, even though sent offers keep their own snapshot.
    await prisma.offerTemplate.update({
      where: { id },
      data: {
        name,
        subject,
        bodyHtml,
        emailIntro,
        version: existing.version + 1,
      },
    });
  } else {
    await prisma.offerTemplate.create({
      data: {
        platformId: viewer.platformId,
        name,
        subject,
        bodyHtml,
        emailIntro,
        isDefault: body.isDefault === true,
      },
    });
  }

  return listTemplates(viewerId);
}

// ---------------------------------------------------------------------------
// OFFERS
// ---------------------------------------------------------------------------
async function renderFor(
  candidateId: string,
  input: {
    templateId?: string | null;
    roleTitle: string;
    joiningDate: Date;
    ctcAnnual?: unknown;
    reportingTo?: string | null;
  }
) {
  const candidate = await prisma.user.findUnique({
    where: { id: candidateId },
    include: { platform: true },
  });
  if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");

  const template = input.templateId
    ? await prisma.offerTemplate.findUnique({ where: { id: input.templateId } })
    : await prisma.offerTemplate.findFirst({
        where: { platformId: candidate.platformId, isDefault: true },
      });

  const values: Record<string, string> = {
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    fullName: `${candidate.firstName} ${candidate.lastName}`.trim(),
    roleTitle: input.roleTitle,
    joiningDate: dmy(input.joiningDate),
    ctc: money(input.ctcAnnual),
    reportingTo: input.reportingTo ?? "your manager",
    company: candidate.platform.name,
    employeeCode: candidate.employeeCode ?? "to be issued",
    today: dmy(new Date()),
  };

  return {
    candidate,
    template,
    html: fill(template?.bodyHtml ?? DEFAULT_BODY, values),
    subject: fill(template?.subject ?? "Your offer from {{company}}", values),
    values,
  };
}

export async function createOffer(
  viewerId: string,
  body: Record<string, unknown>
) {
  const viewer = await staff(viewerId);

  const candidateId = String(body.candidateId ?? "");
  const roleTitle = String(body.roleTitle ?? "").trim();
  const joiningStr = String(body.joiningDate ?? "");

  if (!candidateId || !roleTitle) throw new Error("MISSING_FIELDS");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningStr)) throw new Error("BAD_DATE");

  const joiningDate = parseIsoDay(joiningStr);

  const rendered = await renderFor(candidateId, {
    templateId: body.templateId ? String(body.templateId) : null,
    roleTitle,
    joiningDate,
    ctcAnnual: body.ctcAnnual,
    reportingTo: body.reportingTo ? String(body.reportingTo) : null,
  });

  if (rendered.candidate.platformId !== viewer.platformId) {
    throw new Error("NOT_YOUR_COMPANY");
  }

  // One live offer per candidate. A second DRAFT would let HR send two
  // different letters to the same person.
  const open = await prisma.offer.findFirst({
    where: { candidateId, status: { in: ["DRAFT", "SENT"] } },
  });
  if (open) throw new Error("OFFER_ALREADY_OPEN");

  const offer = await prisma.offer.create({
    data: {
      platformId: viewer.platformId,
      candidateId,
      templateId: rendered.template?.id ?? null,
      roleTitle,
      joiningDate,
      ctcAnnual: body.ctcAnnual ? String(body.ctcAnnual) : null,
      reportingTo: body.reportingTo ? String(body.reportingTo) : null,
      renderedHtml: rendered.html,
      status: "DRAFT" as never,
      expiresAt: body.expiresAt
        ? parseIsoDay(body.expiresAt)
        : null,
    },
  });

  return { offerId: offer.id, html: rendered.html, subject: rendered.subject };
}

// HR reads the filled letter before a single thing is sent.
export async function previewOffer(viewerId: string, offerId: string) {
  const viewer = await staff(viewerId);

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      candidate: {
        select: { firstName: true, lastName: true, email: true, employeeCode: true },
      },
    },
  });
  if (!offer || offer.platformId !== viewer.platformId) throw new Error("NOT_FOUND");

  return {
    id: offer.id,
    status: String(offer.status),
    roleTitle: offer.roleTitle,
    joiningDate: offer.joiningDate.toISOString().slice(0, 10),
    ctcAnnual: offer.ctcAnnual ? String(offer.ctcAnnual) : null,
    reportingTo: offer.reportingTo,
    html: offer.renderedHtml,
    sentAt: offer.sentAt,
    respondedAt: offer.respondedAt,
    declineReason: offer.declineReason,
    candidate: offer.candidate,
  };
}

// ---------------------------------------------------------------------------
// SEND
// A fresh temporary password is issued here rather than reusing whatever HR
// typed when creating the candidate, so the password exists in exactly one
// place — the email — and HR never has to copy it anywhere.
// ---------------------------------------------------------------------------
export async function sendOffer(viewerId: string, offerId: string) {
  const viewer = await staff(viewerId);

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { candidate: { include: { platform: true } } },
  });
  if (!offer || offer.platformId !== viewer.platformId) throw new Error("NOT_FOUND");
  if (String(offer.status) !== "DRAFT") throw new Error("ALREADY_SENT");

  const candidate = offer.candidate;
  if (!candidate.email || candidate.email.endsWith(".local")) {
    // The synthetic addresses the bulk import creates cannot receive mail.
    throw new Error("NO_REAL_EMAIL");
  }

  const password = tempPassword();

  const requirements = await prisma.documentRequirement.findMany({
    where: {
      platformId: offer.platformId,
      isActive: true,
      uploadedByEmployee: true,
    },
    orderBy: { sortOrder: "asc" },
    select: { label: true, isMandatory: true },
  });

  const mail = welcomeEmail({
    firstName: candidate.firstName,
    company: candidate.platform.name,
    roleTitle: offer.roleTitle,
    joiningDate: dmy(offer.joiningDate),
    reportingTo: offer.reportingTo,
    loginEmail: candidate.email,
    temporaryPassword: password,
    setPasswordUrl: `${APP_URL}/login`,
    documents: requirements.map(
      (r) => `${r.label}${r.isMandatory ? "" : " (optional)"}`
    ),
    intro: null,
  });

  const result = await sendMail({
    to: candidate.email,
    subject: mail.subject,
    html: mail.html,
  });

  // The offer is marked sent even if the mailbox is misconfigured, and the
  // result says so — otherwise HR clicks Send repeatedly, issuing a new
  // password each time and invalidating the one that did arrive.
  await prisma.$transaction([
    prisma.offer.update({
      where: { id: offerId },
      data: {
        status: "SENT" as never,
        sentAt: new Date(),
        sentById: viewerId,
      },
    }),
    prisma.user.update({
      where: { id: candidate.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        onboardingStatus: "OFFER_SENT" as never,
      },
    }),
  ]);

  return {
    sent: result.sent,
    reason: result.reason ?? null,
    to: candidate.email,
    // Shown to HR only when the email could not be sent, so they can pass it
    // on by hand instead of the candidate being stuck.
    temporaryPassword: result.sent ? null : password,
  };
}

// ---------------------------------------------------------------------------
// THE CANDIDATE'S SIDE
// ---------------------------------------------------------------------------
export async function myOffer(userId: string) {
  const offer = await prisma.offer.findFirst({
    where: { candidateId: userId, status: { in: ["SENT", "ACCEPTED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!offer) return { offer: null };

  return {
    offer: {
      id: offer.id,
      status: String(offer.status),
      roleTitle: offer.roleTitle,
      joiningDate: offer.joiningDate.toISOString().slice(0, 10),
      html: offer.renderedHtml,
      expiresAt: offer.expiresAt,
      respondedAt: offer.respondedAt,
    },
  };
}

export async function respondToOffer(
  userId: string,
  offerId: string,
  accept: boolean,
  ip: string | null,
  reason?: string
) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer || offer.candidateId !== userId) throw new Error("NOT_FOUND");
  if (String(offer.status) !== "SENT") throw new Error("ALREADY_ANSWERED");

  if (offer.expiresAt && offer.expiresAt.getTime() < Date.now()) {
    await prisma.offer.update({
      where: { id: offerId },
      data: { status: "EXPIRED" as never },
    });
    throw new Error("OFFER_EXPIRED");
  }

  await prisma.$transaction([
    prisma.offer.update({
      where: { id: offerId },
      data: {
        status: (accept ? "ACCEPTED" : "DECLINED") as never,
        respondedAt: new Date(),
        // The IP is the only thing that makes an online acceptance defensible
        // if it is ever questioned.
        responseIp: ip,
        declineReason: accept ? null : reason ? String(reason).slice(0, 500) : null,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: accept
        ? { onboardingStatus: "OFFER_ACCEPTED" as never }
        : { status: "EXITED" as never },
    }),
  ]);

  return myOffer(userId);
}