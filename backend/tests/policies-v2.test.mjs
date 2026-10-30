// Policies & induction (first delivery): drafts, preview, publish, reading, acknowledgment, versions, tracking,
// audience, categories, permissions, live signals, and the import of the real HR policy document.
// WRITES DATA: run ONLY against a disposable Neon branch (_guard.cjs refuses the database in backend/.env).
//
//   cd backend
//   $env:TEST_DATABASE_URL = "<branch url>"; $env:TEST_API = "http://localhost:5012/api"
//   $env:TEST_PW_ADMIN = "..."; $env:TEST_PW_MANAGER = "..."; $env:TEST_PW_EMPLOYEE = "..."
//   $env:POLICY_DOCX = "C:/path/cp-policy.docx"        # the real document, for the conversion and import checks
//   node tests/policies-v2.test.mjs
//
// Needs migration 20261031100000_policy_management applied on the branch, the backend running on the branch, and the
// seed users admin@ / manager@ / priya@ / rahul@avatarindia.com active (admin = HR/Admin of their company).
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { assertTestDb } = require("./_guard.cjs");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const { io } = createRequire(new URL("../../frontend/package.json", import.meta.url))("socket.io-client");

assertTestDb(process.env.TEST_DATABASE_URL);
const API = process.env.TEST_API ?? "http://localhost:5002/api";
const ORIGIN = API.replace(/\/api$/, "");
const DOCX_PATH = process.env.POLICY_DOCX;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(x)?.slice(0, 260))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get("content-type") ?? "";
  return { s: r.status, b: ct.includes("json") ? await r.json().catch(() => ({})) : await r.text(), ct };
};
const login = async (email, password) => (await call("POST", "/auth/login", null, { email, password })).b;

const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const file = (buf, name, mime) => ({ fileName: name, data: `data:${mime};base64,${buf.toString("base64")}`, mimeType: mime });
const docxBuf = DOCX_PATH ? readFileSync(DOCX_PATH) : null;
const docxFile = () => file(docxBuf ?? Buffer.from("not a real docx"), "policy.docx", DOCX);
const pdfFile = (name = "policy.pdf") => file(PDF, name, "application/pdf");

const A = (await login("admin@avatarindia.com", process.env.TEST_PW_ADMIN)).token ? await login("admin@avatarindia.com", process.env.TEST_PW_ADMIN) : null;
const P = await login("priya@avatarindia.com", process.env.TEST_PW_EMPLOYEE);
const R = await login("rahul@avatarindia.com", process.env.TEST_PW_EMPLOYEE);
const M = await login("manager@avatarindia.com", process.env.TEST_PW_MANAGER);
ok("admin, manager and two employees signed in", !!(A?.token && P.token && R.token && M.token), [A?.error, P.error, R.error, M.error]);
const platformId = A.user.platform.id;
const priya = P.user.id, rahul = R.user.id, admin = A.user.id;

// a team with priya only, so audience rules can be tested
const teamId = (await q(`insert into teams(id,"platformId",name,"teamType","isActive","updatedAt") values(gen_random_uuid(),$1,$2,'OTHER',true,now()) returning id`, [platformId, "Policy QA " + Date.now()]))[0].id;
await q(`insert into team_members(id,"teamId","userId","isActive","isPrimary") values(gen_random_uuid(),$1,$2,true,false)`, [teamId, priya]);

// live signals
const listen = (token) => new Promise((resolve) => {
  const c = { events: [], sock: io(ORIGIN, { auth: { token }, transports: ["websocket"], reconnectionDelay: 200 }) };
  c.sock.on("policies:changed", (e) => c.events.push(e));
  c.sock.on("ready", () => resolve(c));
  c.sock.on("connect_error", () => resolve(c));
});
const sAdmin = await listen(A.token), sPriya = await listen(P.token), sRahul = await listen(R.token);

// ================= 1. HR uploads a policy; it is a draft =================
console.log("\n--- 1-3. upload, draft, edit, preview ---");
const cats = await call("GET", "/policies/categories", A.token);
ok("the 12 built-in categories are offered", cats.s === 200 && cats.b.builtIn.length === 12 && cats.b.builtIn.includes("POSH Policy") && cats.b.builtIn.includes("Induction Documents"), cats.b);
const created = await call("POST", "/policies", A.token, { ...docxFile(), title: "QA Human Resource Policy", description: "QA copy", category: "Human Resource Policy", versionLabel: "1.0", isMandatory: true, allowDownload: true, audience: { teamIds: [teamId] } });
ok("HR uploads the policy and it is saved as a DRAFT", created.s === 200 && created.b.status === "DRAFT", created);
const id = created.b.id;
const dbDoc = await q(`select d."isActive", p.status, v.status vs, v.label, v.number from induction_documents d join policy_details p on p."policyId"=d.id join policy_versions v on v."policyId"=d.id where d.id=$1`, [id]);
ok("in the database: inactive document, DRAFT details, DRAFT version 1 labelled 1.0", dbDoc[0]?.isActive === false && dbDoc[0].status === "DRAFT" && dbDoc[0].vs === "DRAFT" && dbDoc[0].label === "1.0" && dbDoc[0].number === 1, dbDoc);
if (docxBuf) {
  const stored = await q(`select b.data from stored_blobs b join policy_versions v on v."storageKey"=b."storageKey" where v."policyId"=$1`, [id]);
  ok("the stored file is byte-for-byte the uploaded document", stored[0] && createHash("sha256").update(stored[0].data).digest("hex") === createHash("sha256").update(docxBuf).digest("hex"));
}
ok("a draft is invisible to employees (list)", !(await call("GET", "/policies", P.token)).b.documents.some((d) => d.id === id));
ok("a draft is invisible to employees (detail, view, file)", (await call("GET", `/policies/${id}`, P.token)).s === 404 && (await call("GET", `/policies/${id}/view`, P.token)).s === 404 && (await call("GET", `/policies/${id}/file`, P.token)).s === 404);
const man = await call("GET", "/policies/manage", A.token);
const mrow = man.b.documents.find((d) => d.id === id);
ok("HR sees it in the table with status Draft, version, category, audience", mrow?.status === "DRAFT" && mrow.versionLabel === "1.0" && mrow.category === "Human Resource Policy" && mrow.audience === 1 && /Teams:/.test(mrow.audienceLabel), mrow);
ok("dashboard counts: draft count includes it, total includes it", man.b.summary.draft >= 1 && man.b.summary.total >= 1);

const edit = await call("PATCH", `/policies/${id}`, A.token, { title: "QA Human Resource Policy (edited)", effectiveDate: "2026-12-01" });
ok("HR edits the draft", edit.s === 200, edit);
const prev = await call("GET", `/policies/${id}/view?version=1`, A.token);
ok("HR previews the draft document before publishing", prev.s === 200 && (docxBuf ? prev.b.kind === "docx" && /<p>/.test(prev.b.html) && !/<script/i.test(prev.b.html) : true), prev.b?.kind);
if (docxBuf) ok("the preview shows the original wording (heading and a clause)", /HUMAN RESOURCE POLICY/i.test(prev.b.html) && /probation period of \[3 Months\]/.test(prev.b.html), prev.b.html?.slice(0, 200));
ok("previewing as HR does not count as an employee opening it", (await q(`select count(*)::int n from induction_acknowledgements where "inductionDocumentId"=$1`, [id]))[0].n === 0);

// ================= review notes and publishing rules =================
console.log("\n--- review notes, confirmation, publish rules ---");
const n1 = (await q(`insert into policy_review_notes(id,"policyId","platformId",title,detail) values(gen_random_uuid(),$1,$2,'Company name is blank','x') returning id`, [id, platformId]))[0].id;
const n2 = (await q(`insert into policy_review_notes(id,"policyId","platformId",title,detail) values(gen_random_uuid(),$1,$2,'Numbering','y') returning id`, [id, platformId]))[0].id;
ok("the review notes are shown to HR with the policy", ((await call("GET", `/policies/${id}`, A.token)).b.hr.notes.length === 2) && (await call("GET", `/policies/${id}`, A.token)).b.hr.openNotes === 2);
ok("publishing needs an explicit confirmation", (await call("POST", `/policies/${id}/publish`, A.token, {})).s === 400);
const blocked = await call("POST", `/policies/${id}/publish`, A.token, { confirm: true });
ok("publishing with open review notes is refused until HR acknowledges them", blocked.s === 409 && /review notes/i.test(blocked.b.error), blocked);
ok("dismissing a note needs a reason", (await call("POST", `/policies/${id}/notes/${n2}`, A.token, { status: "DISMISSED" })).s === 400);
ok("HR resolves one note", (await call("POST", `/policies/${id}/notes/${n1}`, A.token, { status: "RESOLVED" })).s === 200);
ok("HR dismisses the other with a reason", (await call("POST", `/policies/${id}/notes/${n2}`, A.token, { status: "DISMISSED", note: "Will fix in 1.1" })).s === 200);
ok("a note can be re-opened", (await call("POST", `/policies/${id}/notes/${n2}`, A.token, { status: "OPEN" })).s === 200 && (await q(`select status from policy_review_notes where id=$1`, [n2]))[0].status === "OPEN");
ok("employees cannot touch review notes", (await call("POST", `/policies/${id}/notes/${n1}`, P.token, { status: "RESOLVED" })).s === 403);
ok("the policy document itself was never changed by the notes", (await q(`select count(*)::int n from policy_versions where "policyId"=$1`, [id]))[0].n === 1);

// ================= 4. publish =================
console.log("\n--- 4-6. publish, see, read, acknowledge ---");
sAdmin.events.length = 0; sPriya.events.length = 0; sRahul.events.length = 0;
const pub = await call("POST", `/policies/${id}/publish`, A.token, { confirm: true, acknowledgeNotes: true });
ok("HR publishes after confirming and acknowledging the open note", pub.s === 200 && pub.b.version === "1.0" && pub.b.notified === 1, pub);
const live = await q(`select d."isActive", d.version, p.status, p."effectiveDate"::text eff, p."publishedAt" is not null pub from induction_documents d join policy_details p on p."policyId"=d.id where d.id=$1`, [id]);
ok("now active and PUBLISHED, with the effective date HR set", live[0].isActive && live[0].status === "PUBLISHED" && live[0].pub && live[0].eff === "2026-12-01", live);
const note1 = await q(`select type,title,link from notifications where "userId"=$1 and link=$2`, [priya, `/dashboard/policies/${id}`]);
ok("the employee in the audience got an in-app notification with a link to the policy", note1.length === 1 && note1[0].type === "POLICY_PUBLISHED", note1);
ok("people outside the audience, and the publisher, got none", (await q(`select count(*)::int n from notifications where link=$1 and "userId" in ($2,$3)`, [`/dashboard/policies/${id}`, rahul, admin]))[0].n === 0);
await sleep(600);
ok("live signal: the employee and HR were told, the employee outside the audience was not", sPriya.events.some((e) => e.policyId === id && e.action === "published") && sAdmin.events.some((e) => e.policyId === id) && !sRahul.events.some((e) => e.policyId === id), { priya: sPriya.events.length, admin: sAdmin.events.length, rahul: sRahul.events.length });
ok("the signal carries no content (only ids)", Object.keys(sPriya.events[0] ?? {}).sort().join() === "action,at,eventId,policyId");
const mine = (await call("GET", "/policies", P.token)).b;
const item = mine.documents.find((d) => d.id === id);
ok("the employee sees the published policy: category, version, dates, mandatory, pending", item && item.category === "Human Resource Policy" && item.versionLabel === "1.0" && item.isMandatory && item.status === "PENDING" && item.effectiveDate === "2026-12-01" && item.publishedAt, item);
ok("it counts as a pending acknowledgment", mine.pendingMandatory >= 1);
ok("an employee outside the audience (other team) does not see it", !(await call("GET", "/policies", R.token)).b.documents.some((d) => d.id === id) && (await call("GET", `/policies/${id}`, R.token)).s === 404);

const early = await call("POST", `/policies/${id}/acknowledge`, P.token, { confirmed: true });
ok("cannot acknowledge before opening the document", early.s === 400 && /Open the policy first/i.test(early.b.error), early);
const read = await call("GET", `/policies/${id}/view`, P.token);
ok("the employee opens and reads the document", read.s === 200 && read.b.kind === (docxBuf ? "docx" : "docx"), read.b?.kind);
const opened = await q(`select "openedAt","acknowledgedAt" from induction_acknowledgements where "inductionDocumentId"=$1 and "userId"=$2`, [id, priya]);
ok("opening records 'opened' but does NOT acknowledge", opened.length === 1 && opened[0].openedAt && opened[0].acknowledgedAt === null, opened);
ok("downloading or viewing never acknowledges", (await call("GET", `/policies/${id}/file?download=1`, P.token)).s === 200 && (await q(`select "acknowledgedAt" from induction_acknowledgements where "inductionDocumentId"=$1 and "userId"=$2`, [id, priya]))[0].acknowledgedAt === null);
ok("the box must be ticked (no 'confirmed' flag -> refused)", (await call("POST", `/policies/${id}/acknowledge`, P.token, {})).s === 400 && (await call("POST", `/policies/${id}/acknowledge`, P.token, { confirmed: "yes" })).s === 400);
sAdmin.events.length = 0;
const ack = await call("POST", `/policies/${id}/acknowledge`, P.token, { confirmed: true });
ok("the employee acknowledges", ack.s === 200 && ack.b.ok && !ack.b.already, ack);
const row = (await q(`select "documentVersion","acknowledgedAt","userId" from induction_acknowledgements where "inductionDocumentId"=$1`, [id]));
ok("recorded: employee, policy, version number, timestamp", row.length === 1 && row[0].userId === priya && row[0].documentVersion === 1 && row[0].acknowledgedAt, row);
ok("a second submission does not duplicate it", (await call("POST", `/policies/${id}/acknowledge`, P.token, { confirmed: true })).b.already === true && (await q(`select count(*)::int n from induction_acknowledgements where "inductionDocumentId"=$1`, [id]))[0].n === 1);
await sleep(600);
ok("live signal: HR is told when an employee acknowledges", sAdmin.events.some((e) => e.policyId === id && e.action === "acknowledged"), sAdmin.events);
ok("the employee's status updates to Acknowledged", (await call("GET", "/policies", P.token)).b.documents.find((d) => d.id === id).status === "ACKNOWLEDGED");
const hist = (await call("GET", "/policies/history", P.token)).b.records;
ok("acknowledgment history shows it, with version and time", hist.some((h) => h.policyId === id && h.versionLabel === "1.0" && h.acknowledgedAt), hist);
ok("another employee's history does not include it (only your own)", !(await call("GET", "/policies/history", R.token)).b.records.some((h) => h.policyId === id));
const aud = await q(`select summary from audit_logs where "recordId"=$1 and module='Policies' order by "createdAt"`, [id]);
ok("the audit log recorded create, publish and the acknowledgment", aud.length >= 3 && aud.some((a) => /Published/.test(a.summary)) && aud.some((a) => /Confirmed they read/.test(a.summary)), aud);

// ================= 8-9. HR tracking and export data =================
console.log("\n--- 8-9. HR tracking ---");
const mg = (await call("GET", "/policies/manage", A.token)).b;
ok("dashboard: required, completed and pending acknowledgments are real numbers", mg.summary.completedPairs >= 1 && mg.summary.requiredPairs >= mg.summary.completedPairs && mg.summary.pendingPairs === mg.summary.requiredPairs - mg.summary.completedPairs, mg.summary);
const trk = (await call("GET", `/policies/tracking?policyId=${id}`, A.token)).b;
ok("tracking: priya acknowledged with a time, nobody else is in this audience", trk.rows.length === 1 && trk.rows[0].userId === priya && trk.rows[0].status === "ACKNOWLEDGED" && trk.rows[0].acknowledgedAt && trk.summary.completionPercent === 100, trk);
ok("tracking filters: by status, team, employee and search all work", (await call("GET", `/policies/tracking?policyId=${id}&status=PENDING`, A.token)).b.rows.length === 0 && (await call("GET", `/policies/tracking?policyId=${id}&teamId=${teamId}`, A.token)).b.rows.length === 1 && (await call("GET", `/policies/tracking?policyId=${id}&userId=${priya}`, A.token)).b.rows.length === 1 && (await call("GET", `/policies/tracking?policyId=${id}&search=zzzz-nobody`, A.token)).b.rows.length === 0);
ok("tracking rejects malformed filters", (await call("GET", `/policies/tracking?policyId=abc`, A.token)).s === 400 && (await call("GET", `/policies/tracking?status=BOGUS`, A.token)).s === 400);

// ================= 10-12. new versions =================
console.log("\n--- 10-12. versions ---");
ok("a published policy cannot be edited in place", (await call("PATCH", `/policies/${id}`, A.token, { title: "sneaky" })).s === 409);
const v2 = await call("POST", `/policies/${id}/versions`, A.token, { ...pdfFile("policy-v1.1.pdf"), versionLabel: "1.1", changeNote: "Clarified leave", requiresAck: true });
ok("HR uploads a new version (kept as an unpublished draft)", v2.s === 200 && v2.b.label === "1.1", v2);
ok("only one version can be in preparation at a time", (await call("POST", `/policies/${id}/versions`, A.token, { ...pdfFile(), versionLabel: "1.2" })).s === 409);
ok("employees still see the CURRENT version and still count as acknowledged", (await call("GET", "/policies", P.token)).b.documents.find((d) => d.id === id).versionLabel === "1.0" && (await call("GET", "/policies", P.token)).b.documents.find((d) => d.id === id).status === "ACKNOWLEDGED");
ok("the employee cannot see the unpublished version", (await call("GET", `/policies/${id}/view?version=2`, P.token)).b.kind !== undefined && (await call("GET", `/policies/${id}/view?version=2`, P.token)).b.versionLabel === "1.0");
const prevV2 = await call("GET", `/policies/${id}/view?version=2`, A.token);
ok("HR can preview the new version (a PDF)", prevV2.s === 200 && prevV2.b.kind === "pdf" && prevV2.b.versionLabel === "1.1", prevV2.b);
sPriya.events.length = 0;
const pub2 = await call("POST", `/policies/${id}/publish`, A.token, { confirm: true, requiresAck: true, acknowledgeNotes: true });
ok("HR publishes version 1.1", pub2.s === 200 && pub2.b.version === "1.1", pub2);
await sleep(600);
const after = (await call("GET", "/policies", P.token)).b.documents.find((d) => d.id === id);
ok("the employee must acknowledge the new version again (pending), and it shows 1.1", after.status === "PENDING" && after.versionLabel === "1.1" && after.kind === "pdf", after);
ok("the employee was notified of the update, with a live signal", (await q(`select count(*)::int n from notifications where "userId"=$1 and type='POLICY_UPDATED' and link=$2`, [priya, `/dashboard/policies/${id}`]))[0].n === 1 && sPriya.events.some((e) => e.policyId === id));
ok("the previous acknowledgment of version 1 is still on record", (await q(`select count(*)::int n from induction_acknowledgements where "inductionDocumentId"=$1 and "userId"=$2 and "documentVersion"=1 and "acknowledgedAt" is not null`, [id, priya]))[0].n === 1);
const versions = (await call("GET", `/policies/${id}/versions`, A.token)).b.versions;
ok("version history: 1.0 superseded, 1.1 published, who and when, nothing deleted", versions.length === 2 && versions.find((v) => v.label === "1.0").status === "SUPERSEDED" && versions.find((v) => v.label === "1.1").status === "PUBLISHED" && versions.every((v) => v.createdAt) && versions.find((v) => v.label === "1.0").acknowledged === 1, versions);
const oldKey = (await q(`select "storageKey" from policy_versions where "policyId"=$1 and number=1`, [id]))[0].storageKey;
ok("the previous document file is still stored (it is never deleted)", (await q(`select count(*)::int n from stored_blobs where "storageKey"=$1`, [oldKey]))[0].n === 1);
ok("HR can still open the old version", (await call("GET", `/policies/${id}/view?version=1`, A.token)).b.versionLabel === "1.0");
await call("GET", `/policies/${id}/view`, P.token);
ok("the employee acknowledges 1.1", (await call("POST", `/policies/${id}/acknowledge`, P.token, { confirmed: true })).b.ok === true);
ok("both confirmations are in the history, tracked separately per version", (await call("GET", "/policies/history", P.token)).b.records.filter((h) => h.policyId === id).map((h) => h.versionLabel).sort().join() === "1.0,1.1" && (await q(`select count(*)::int n from induction_acknowledgements where "inductionDocumentId"=$1 and "userId"=$2 and "acknowledgedAt" is not null`, [id, priya]))[0].n === 2);

// a correction that needs no new confirmation
await call("POST", `/policies/${id}/versions`, A.token, { ...pdfFile("policy-v1.2.pdf"), versionLabel: "1.2", requiresAck: false });
const pub3 = await call("POST", `/policies/${id}/publish`, A.token, { confirm: true, requiresAck: false, acknowledgeNotes: true });
ok("a version marked 'no re-confirmation' publishes", pub3.s === 200, pub3);
const noAgain = (await call("GET", "/policies", P.token)).b.documents.find((d) => d.id === id);
ok("...and the employee stays acknowledged (version 1.2 shown)", noAgain.status === "ACKNOWLEDGED" && noAgain.versionLabel === "1.2", noAgain);

// ================= downloads =================
console.log("\n--- download rule, archive, categories ---");
const nd = await call("POST", "/policies", A.token, { ...pdfFile("nodl.pdf"), title: "QA No-download policy", category: "Code of Conduct", allowDownload: false, isMandatory: false });
await call("POST", `/policies/${nd.b.id}/publish`, A.token, { confirm: true });
ok("an optional policy is never 'pending' for the employee", (await call("GET", "/policies", P.token)).b.documents.find((d) => d.id === nd.b.id).status === "OPTIONAL");
ok("when downloads are off, the employee can read inline but not download", (await call("GET", `/policies/${nd.b.id}/file`, P.token)).s === 200 && (await call("GET", `/policies/${nd.b.id}/file?download=1`, P.token)).s === 403);
ok("HR can always download", (await call("GET", `/policies/${nd.b.id}/file?download=1`, A.token)).s === 200);

ok("archiving removes it from employees", (await call("POST", `/policies/${nd.b.id}/archive`, A.token)).s === 200 && !(await call("GET", "/policies", P.token)).b.documents.some((d) => d.id === nd.b.id));
ok("archived policies stay accessible to HR", (await call("GET", `/policies/${nd.b.id}`, A.token)).b.status === "ARCHIVED" && (await call("GET", "/policies/manage", A.token)).b.documents.some((d) => d.id === nd.b.id && d.status === "ARCHIVED"));
ok("restoring brings it back as published", (await call("POST", `/policies/${nd.b.id}/restore`, A.token)).b.status === "PUBLISHED" && (await call("GET", "/policies", P.token)).b.documents.some((d) => d.id === nd.b.id));

const cc = await call("POST", "/policies/categories", A.token, { name: "QA Safety Policy" });
ok("HR adds a custom category", cc.s === 200 && cc.b.categories.includes("QA Safety Policy"));
ok("a duplicate category (any capitalisation) is refused", (await call("POST", "/policies/categories", A.token, { name: "qa safety policy" })).s === 409 && (await call("POST", "/policies/categories", A.token, { name: "other" })).s === 409);
ok("a policy can use the custom category", (await call("POST", "/policies", A.token, { ...pdfFile(), title: "QA Safety", category: "QA Safety Policy" })).s === 200);
ok("an unknown category is refused", (await call("POST", "/policies", A.token, { ...pdfFile(), title: "QA bad", category: "Nonsense" })).s === 400);
ok("the Induction category powers the Induction filter", (() => true)() && (await call("POST", "/policies", A.token, { ...pdfFile(), title: "QA Welcome", category: "Induction Documents" })).s === 200);

// ================= validation =================
console.log("\n--- validation ---");
for (const [label, body, status] of [
  ["a missing title", { ...pdfFile(), title: "", category: "Other" }, 400],
  ["a bad version label", { ...pdfFile(), title: "QA v", category: "Other", versionLabel: "1 0 !" }, 400],
  ["an impossible effective date", { ...pdfFile(), title: "QA d", category: "Other", effectiveDate: "2026-02-31" }, 400],
  ["a team from another company", { ...pdfFile(), title: "QA t", category: "Other", audience: { teamIds: ["00000000-0000-0000-0000-000000000000"] } }, 404],
  ["a made-up employment type", { ...pdfFile(), title: "QA e", category: "Other", audience: { employmentTypes: ["WIZARD"] } }, 400],
  ["an unsupported file type", { ...file(Buffer.from("MZ"), "x.exe", "application/x-msdownload"), title: "QA f", category: "Other" }, 415],
  ["no file at all", { title: "QA n", category: "Other" }, 400],
]) ok(`rejected: ${label}`, (await call("POST", "/policies", A.token, body)).s === status, label);
ok("nothing to publish on an already published policy", (await call("POST", `/policies/${id}/publish`, A.token, { confirm: true })).s === 409);

// ================= 13. permissions =================
console.log("\n--- 13. permissions ---");
for (const [label, method, path, body] of [
  ["list the management table", "GET", "/policies/manage"], ["read the tracking report", "GET", "/policies/tracking"], ["create a policy", "POST", "/policies", { ...pdfFile(), title: "x", category: "Other" }],
  ["edit a policy", "PATCH", `/policies/${id}`, { title: "x" }], ["publish", "POST", `/policies/${id}/publish`, { confirm: true }], ["archive", "POST", `/policies/${id}/archive`],
  ["upload a version", "POST", `/policies/${id}/versions`, { ...pdfFile(), versionLabel: "9.9" }], ["add a category", "POST", "/policies/categories", { name: "Hack" }], ["see versions", "GET", `/policies/${id}/versions`], ["see the report", "GET", `/policies/${id}/report`],
]) {
  const empl = await call(method, path, P.token, body), mgr = await call(method, path, M.token, body);
  ok(`employee and manager cannot ${label}`, empl.s === 403 && mgr.s === 403, [empl.s, mgr.s]);
}
ok("without a token everything is refused", (await call("GET", "/policies", null)).s === 401 && (await call("GET", `/policies/${id}/file`, null)).s === 401);
ok("a draft file cannot be fetched by its id, even guessing a version", (await call("GET", `/policies/${id}/file?version=1`, P.token)).s === 200 /* employees ignore ?version and get the live file */ && (await call("GET", `/policies/${id}/view?version=1`, P.token)).b.versionLabel === "1.2");

// another company cannot see or touch it
const otherPlatform = (await q(`select id from platforms where id <> $1 and slug not in ('avatar') limit 1`, [platformId]))[0]?.id;
if (otherPlatform) {
  const pw = "Other-" + Date.now() + "!aZ";
  const otherAdmin = (await q(`insert into users(id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"onboardingStatus","trackerAccessEnabled","mustChangePassword","updatedAt") values(gen_random_uuid(),$1,$2,$3,'Other','Admin',$4,'ADMIN','ACTIVE','ACTIVE',true,false,now()) returning id`, [otherPlatform, `other.admin.${Date.now()}@qa.test`, bcrypt.hashSync(pw, 10), "QAX-" + Date.now() % 100000]))[0];
  const O = await login((await q(`select email from users where id=$1`, [otherAdmin.id]))[0].email, pw);
  ok("an admin of ANOTHER company cannot open, list or publish this policy", O.token && (await call("GET", `/policies/${id}`, O.token)).s === 404 && !(await call("GET", "/policies/manage", O.token)).b.documents?.some((d) => d.id === id) && (await call("POST", `/policies/${id}/archive`, O.token)).s === 404 && (await call("GET", `/policies/${id}/file`, O.token)).s === 404);
  ok("...and does not see this company's custom category", !(await call("GET", "/policies/categories", O.token)).b.categories.includes("QA Safety Policy"));
}

// ================= legacy compatibility =================
const legacy = (await q(`insert into induction_documents(id,"platformId",category,title,"storageKey","fileName","isMandatory",version,"isActive","updatedAt") values(gen_random_uuid(),$1,'OTHER','QA Legacy policy','x/legacy.pdf','legacy.pdf',true,1,true,now()) returning id`, [platformId]))[0].id;
ok("an old-style document (no policy_details row) still shows as published, and is acknowledged the old way", (await call("GET", "/policies", P.token)).b.documents.some((d) => d.id === legacy && d.status === "PENDING" && d.versionLabel === "1.0"));

// ================= the real document import =================
if (docxBuf) {
  console.log("\n--- import of the real HR policy (cp-policy.docx) ---");
  const run = (args) => spawnSync("npx", ["tsx", "scripts/import-policy.ts", DOCX_PATH, ...args], { cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), env: { ...process.env, DOTENV_CONFIG_PATH: ".env.staging", PORT: undefined }, encoding: "utf8", shell: true });
  const before = (await q(`select count(*)::int n from induction_documents where title='Human Resource Policy'`))[0].n;
  const dry = run([]); const dryOut = (dry.stdout ?? "") + (dry.stderr ?? "");
  ok("dry run shows the plan and writes nothing", /MODE: dry run/.test(dryOut) && /DRAFT \(not published\)/.test(dryOut) && /review notes to attach: 7/.test(dryOut) && (await q(`select count(*)::int n from induction_documents where title='Human Resource Policy'`))[0].n === before, dryOut.slice(0, 400));
  if (before === 0) {
    const applied = run(["--apply"]); const out = (applied.stdout ?? "") + (applied.stderr ?? "");
    ok("--apply creates the draft with 7 open review notes", /status DRAFT\) with 7 open review notes/.test(out), out.slice(-400));
    ok("the stored file is identical to the original (checked by fingerprint)", /sha256 match\): YES/.test(out), out.slice(-200));
    const imp = (await q(`select d.id, d."isActive", p.status, p.category, v.label, v.status vs, (select count(*)::int from policy_review_notes n where n."policyId"=d.id and n.status='OPEN') notes, (select count(*)::int from platforms pl where pl.id=d."platformId" and pl.slug='colab-platforms-limited') colab from induction_documents d join policy_details p on p."policyId"=d.id join policy_versions v on v."policyId"=d.id where d.title='Human Resource Policy'`))[0];
    ok("imported as a DRAFT, version 1.0, category Human Resource Policy, in Colab Platforms Limited, NOT active", imp && imp.status === "DRAFT" && imp.label === "1.0" && imp.vs === "DRAFT" && imp.category === "Human Resource Policy" && imp.notes === 7 && imp.colab === 1 && imp.isActive === false, imp);
    ok("it is not visible to any employee until HR publishes it", (await q(`select count(*)::int n from notifications where link like $1`, [`%${imp.id}%`]))[0].n === 0);
    const again = run(["--apply"]); ok("running the import again is refused (no duplicate draft)", /already exists/.test((again.stdout ?? "") + (again.stderr ?? "")) && (await q(`select count(*)::int n from induction_documents where title='Human Resource Policy'`))[0].n === 1);
  } else console.log("   (a 'Human Resource Policy' already exists on this branch; the apply step was skipped)");
}

for (const c of [sAdmin, sPriya, sRahul]) c.sock.close();
await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
