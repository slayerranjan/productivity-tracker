// One-off: import the company HR policy (cp-policy.docx) as a DRAFT for HR to review. It is NOT published.
//
//   npx tsx scripts/import-policy.ts "C:/path/cp-policy.docx"           dry run: shows the plan, writes nothing
//   npx tsx scripts/import-policy.ts "C:/path/cp-policy.docx" --apply   creates the draft and its review notes
//
// The document is stored EXACTLY as provided (its fingerprint is checked after saving). No clause is corrected,
// reworded or removed: the problems found while reading it are attached as review notes for HR to decide on.
// Run it only after the migration 20261031100000_policy_management has been applied.
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { createDocument } from "../src/modules/policies/policies.service.js";
import { readStored } from "../src/lib/storage.js";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");
const COMPANY_SLUG = process.env.POLICY_COMPANY_SLUG ?? "colab-platforms-limited";
const TITLE = "Human Resource Policy";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// What HR has to look at, found by reading the document. Quotes are copied from it; nothing is changed.
const NOTES: { title: string; detail: string }[] = [
  {
    title: "The company name is blank",
    detail: 'Section 1 reads "issued by (“the Company”)". The name of the company that issues the policy is missing.',
  },
  {
    title: "Probation period is a placeholder",
    detail: 'Section 2 says "a probation period of [3 Months]". The square brackets suggest the figure was never confirmed. Confirm the probation period.',
  },
  {
    title: "Section numbering is broken",
    detail: 'The numbers run 1 to 8, then 10 (there is no 9), then 11, 12 and 13, and then "14" is used twice (14. ANTI-SEXUAL HARASSMENT (POSH) POLICY and 14. AMENDMENTS). In section 5 the list starts at "c." with no "a." or "b.".',
  },
  {
    title: "Leave entitlement is incomplete or ambiguous",
    detail: 'Section 5 gives no number of days for Sick Leave or Earned Leave ("as per the limits determined by the Company"). "Eligible for one paid leave after probation" does not say whether that is per year or per month. Clause c. says Earned Leave "may / may not be carried forward", which does not state the rule. The missing items a. and b. may have contained the limits.',
  },
  {
    title: "Attendance and deduction rules need confirmation",
    detail: 'A full day is "8 hours of working and 1 hour break", yet "less than 8 hours and 45 minutes" is a half day: is that time on site or time worked? A half day is "4 hours of working and 30 minutes break" and under 4 hours 30 minutes is absent. "Every three instances of late coming, one half-day shall be deducted" and "every six instances ... one full day": does six replace the two half-days or add to them? "2nd and 4th Saturday as half day" is not reflected in the stated hours. NOTE: the HRMS currently treats 8 hours as a full day and 4 hours as a half day, so payroll would not follow these thresholds until HR decides.',
  },
  {
    title: "Confidentiality clause wording needs clarification",
    detail: 'Section 11 says employees shall not share company data with "any third party, unauthorized personnel, authorized personnel or external platform without prior written approval". Listing "authorized personnel" among the people it must not be shared with looks like a mistake. The next clause also relies on a Non-Disclosure Agreement (NDA): confirm one exists and is signed.',
  },
  {
    title: "Typos and unclear wording",
    detail: 'Dress code: "It woold be Semi Formal..." (woold). Performance: "KPIs/ KRS" (KRAs?), "esop", "behavior, and or an individual performance". Amendments: "amend this, Policy". Exit: the 45-day period for the relieving letter "shall include the duration of the notice period served", which is ambiguous. These are listed so HR can decide; nothing was changed.',
  },
];

async function main() {
  if (!file) throw new Error('Usage: npx tsx scripts/import-policy.ts "path/to/cp-policy.docx" [--apply]');
  const buffer = readFileSync(file);
  const sha = createHash("sha256").update(buffer).digest("hex");

  const company = await prisma.platform.findUnique({ where: { slug: COMPANY_SLUG }, select: { id: true, name: true } });
  if (!company) throw new Error(`No company with slug "${COMPANY_SLUG}"`);
  const hr = await prisma.user.findFirst({ where: { platformId: company.id, employeeCode: "CP-03", role: "HR", status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } })
    ?? (await prisma.user.findFirst({ where: { platformId: company.id, role: { in: ["HR", "ADMIN"] }, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } }));
  if (!hr) throw new Error(`${company.name} has no active HR or Admin to own the draft`);
  const existing = await prisma.inductionDocument.findFirst({ where: { platformId: company.id, title: TITLE }, select: { id: true } });

  console.log(APPLY ? "MODE: apply" : "MODE: dry run (nothing is written)");
  console.log(`company: ${company.name} | created by: ${hr.firstName} ${hr.lastName} | file: ${buffer.length} bytes | sha256 ${sha.slice(0, 16)}...`);
  console.log(`title: ${TITLE} | category: Human Resource Policy | version 1.0 | status: DRAFT (not published) | audience: all employees | acknowledgement: required`);
  console.log(`review notes to attach: ${NOTES.length}`);
  NOTES.forEach((n, i) => console.log(`  ${i + 1}. ${n.title}`));
  if (existing) {
    console.log(`\nA policy titled "${TITLE}" already exists in ${company.name}. Not creating a duplicate.`);
    process.exitCode = 1;
    return;
  }
  if (!APPLY) return;

  const created = await createDocument(hr.id, {
    fileName: "cp-policy.docx",
    data: `data:${DOCX};base64,${buffer.toString("base64")}`,
    mimeType: DOCX,
    category: "Human Resource Policy",
    title: TITLE,
    description: "Company Human Resource Policy (imported from cp-policy.docx). Draft: awaiting HR review before publication.",
    versionLabel: "1.0",
    isMandatory: true,
    allowDownload: true,
  });
  const version = await prisma.policyVersion.findFirst({ where: { policyId: created.id, number: 1 }, select: { id: true, storageKey: true } });
  await prisma.policyReviewNote.createMany({ data: NOTES.map((n) => ({ policyId: created.id, platformId: company.id, versionId: version?.id ?? null, title: n.title, detail: n.detail })) });

  const stored = await readStored(version!.storageKey);
  const same = createHash("sha256").update(stored).digest("hex") === sha;
  console.log(`\nCreated draft ${created.id} (status ${created.status}) with ${NOTES.length} open review notes.`);
  console.log(`stored file identical to the original (sha256 match): ${same ? "YES" : "NO !!"}`);
  if (!same) process.exitCode = 1;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
