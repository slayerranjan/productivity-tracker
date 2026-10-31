// One-off: adds the company "Human Resource Policy" (text supplied by the owner, kept word for word) to EVERY active company that has an
// active HR/Admin, and publishes it (people are notified and asked to confirm). Companies with no HR/Admin are skipped and listed.
//
//   npx tsx scripts/add-hr-policy-everywhere.ts "<policy.txt>"           dry run: shows the plan, writes nothing
//   npx tsx scripts/add-hr-policy-everywhere.ts "<policy.txt>" --apply   creates + publishes it in each listed company
//   ... --as CP-03    companies with no HR/Admin of their own are handled by that OWNER HR/Admin (who must be in OWNER_CODES).
//                     Companies with nobody in them are skipped.
//
// The text is only wrapped into a Word file (one paragraph per line, section headings in bold); no wording, numbering or spelling
// is changed. Re-running skips any company that already has a policy with this title.
import "dotenv/config";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import mammoth from "mammoth";
import { prisma } from "../src/lib/prisma.js";
import { createDocument, publish } from "../src/modules/policies/policies.service.js";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");
const asIdx = process.argv.indexOf("--as");
const AS_CODE = asIdx > 0 ? process.argv[asIdx + 1] : null;
const TITLE = "Human Resource Policy";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function buildDocx(text: string): Promise<Buffer> {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const body = lines.map((line) => {
    const bold = /^\d+\. [A-Z]/.test(line) || line === "HUMAN RESOURCE POLICY";
    const runs = line.split("\t").map((part, i) => `${i > 0 ? "<w:r><w:tab/></w:r>" : ""}<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>`).join("");
    return `<w:p>${runs}</w:p>`;
  }).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function main() {
  if (!file) throw new Error('Usage: npx tsx scripts/add-hr-policy-everywhere.ts "policy.txt" [--apply]');
  const text = readFileSync(file, "utf8");
  const buffer = await buildDocx(text);
  const check = (await mammoth.extractRawText({ buffer })).value.replace(/\s+/g, " ").trim();
  const source = text.replace(/\s+/g, " ").trim();
  if (check !== source) throw new Error("The Word file does not read back identical to the text: stopped.");
  console.log(APPLY ? "MODE: apply" : "MODE: dry run (nothing is written)");
  console.log(`document: ${buffer.length} bytes; reads back identical to the supplied text (${source.length} characters)`);

  const companies = await prisma.platform.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } });
  const todo: { id: string; name: string; hrId: string; hrName: string; people: number; actAs?: string }[] = [];
  const owner = AS_CODE ? await prisma.user.findFirst({ where: { employeeCode: AS_CODE, role: { in: ["HR", "ADMIN"] }, status: "ACTIVE" }, select: { id: true, platformId: true, firstName: true, lastName: true } }) : null;
  if (AS_CODE && !owner) throw new Error(`No active HR/Admin with the code ${AS_CODE}`);
  for (const c of companies) {
    const hr = (await prisma.user.findFirst({ where: { platformId: c.id, role: "HR", status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, firstName: true, lastName: true } }))
      ?? (await prisma.user.findFirst({ where: { platformId: c.id, role: "ADMIN", status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, firstName: true, lastName: true } }));
    const people = await prisma.user.count({ where: { platformId: c.id, status: { in: ["ACTIVE", "INVITED"] } } });
    const exists = await prisma.inductionDocument.findFirst({ where: { platformId: c.id, title: TITLE }, select: { id: true } });
    if (exists) { console.log(`  SKIP  ${c.name}: already has "${TITLE}"`); continue; }
    if (!hr && owner && people > 0) {
      console.log(`  ADD   ${c.name}: by ${owner.firstName} ${owner.lastName} (owner, acting for this company), ${people} people`);
      todo.push({ id: c.id, name: c.name, hrId: owner.id, hrName: `${owner.firstName} ${owner.lastName}`, people, actAs: c.id });
      continue;
    }
    if (!hr) { console.log(`  SKIP  ${c.name}: no active HR or Admin to publish it (${people} people)`); continue; }
    if (!hr) continue;
    console.log(`  ADD   ${c.name}: by ${hr.firstName} ${hr.lastName}, ${people} people`);
    todo.push({ id: c.id, name: c.name, hrId: hr.id, hrName: `${hr.firstName} ${hr.lastName}`, people });
  }
  if (!APPLY) { console.log(`\nDRY RUN: ${todo.length} compan${todo.length === 1 ? "y" : "ies"} would get it. Nothing changed.`); return; }

  for (const c of todo) {
    const created = await createDocument(c.hrId, {
      fileName: "Human Resource Policy.docx",
      data: `data:${DOCX};base64,${buffer.toString("base64")}`,
      mimeType: DOCX,
      category: "Human Resource Policy",
      title: TITLE,
      description: "Company Human Resource Policy.",
      versionLabel: "1.0",
      isMandatory: true,
      allowDownload: true,
    }, c.actAs);
    const out = await publish(c.hrId, created.id, { confirm: true }, c.actAs);
    console.log(`  DONE  ${c.name}: published, ${out.notified} people notified`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
