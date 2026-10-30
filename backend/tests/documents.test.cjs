// Document requirements: configuration, employee view, HR tracking/review, employment type.
// Disposable Neon branch only (see _guard.cjs). Backend must run on :5002 against that branch.
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const API = (process.env.TEST_API ?? "http://localhost:5002/api");
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);

const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j, raw: txt };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
const PW = "Doc@12345678";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const AV = (await q(`select id from platforms where slug='avatar'`))[0].id;
  const AVN = (await q(`select id from platforms where slug='avance'`))[0].id;
  const hash = await bcrypt.hash(PW, 10);
  const wipe = async () => {
    await q(`delete from users where "employeeCode" like 'DOC-%'`);
    await q(`delete from document_requirements where label like 'Zzz %'`);
  };
  await wipe();
  const mk = async (code, role, platformId = AV) => {
    await q(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Doc',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',now(),now())`, [platformId, code.toLowerCase() + "@doc.test", hash, code.replace("DOC-", "T"), code, role]);
    const id = (await q(`select id from users where "employeeCode"=$1`, [code]))[0].id;
    const tok = (await call("POST", "/auth/login", null, { email: code, password: PW })).b.token;
    return { id, tok };
  };
  const E = await mk("DOC-E", "EMPLOYEE"), E2 = await mk("DOC-E2", "EMPLOYEE"), M = await mk("DOC-M", "MANAGER"), H = await mk("DOC-H", "HR"), X = await mk("DOC-X", "HR", AVN);

  console.log("\n## 1. Configuring requirements (HR/Admin)");
  ok("employee cannot list requirements -> 403", (await call("GET", "/onboarding/requirements", E.tok)).s === 403);
  ok("manager cannot list or change requirements -> 403", (await call("GET", "/onboarding/requirements", M.tok)).s === 403 && (await call("POST", "/onboarding/requirements", M.tok, { category: "OTHER", label: "Zzz Nope" })).s === 403);
  ok("no token -> 401", (await call("GET", "/onboarding/requirements")).s === 401);
  const list0 = (await call("GET", "/onboarding/requirements", H.tok)).b.requirements;
  ok("HR sees the existing requirements untouched, each with 'applies to' and submission counts", list0.length > 0 && list0.every((r) => Array.isArray(r.appliesTo) && typeof r.submitted === "number"), list0[0]);
  const base = list0.filter((r) => r.isActive && r.isMandatory && r.uploadedByEmployee).length;
  const a = await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Zzz Alpha document", helpText: "Any recent proof", isMandatory: true, uploadedByEmployee: true });
  ok("HR adds a requirement (name, description, required, type)", a.s === 200 && a.b.requirement.id, a);
  const A_ID = a.b.requirement.id;
  ok("duplicate name -> 409", (await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Zzz Alpha document" })).s === 409);
  ok("too short / too long name -> 400", (await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Z" })).s === 400 && (await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Zzz " + "x".repeat(120) })).s === 400);
  ok("bad type / bad employment type / over-long description -> 400", (await call("POST", "/onboarding/requirements", H.tok, { category: "NOPE", label: "Zzz Beta" })).s === 400 && (await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Zzz Beta", appliesTo: ["ASTRONAUT"] })).s === 400 && (await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Zzz Beta", helpText: "x".repeat(400) })).s === 400);
  ok("appliesTo must be a list", (await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Zzz Beta", appliesTo: "INTERN" })).s === 400);
  const b = await call("POST", "/onboarding/requirements", H.tok, { category: "OTHER", label: "Zzz Intern only", isMandatory: true, appliesTo: ["INTERN"] });
  ok("a requirement can be limited to employment types", b.s === 200 && JSON.stringify(b.b.requirement.appliesTo) === '["INTERN"]', b);
  const B_ID = b.b.requirement.id;
  ok("HR of another company cannot edit it -> 404", (await call("POST", "/onboarding/requirements", X.tok, { id: A_ID, category: "OTHER", label: "Hacked" })).s === 404);
  ok("...and does not see it in their list", !(await call("GET", "/onboarding/requirements", X.tok)).b.requirements.some((r) => r.id === A_ID));
  const upd = await call("POST", "/onboarding/requirements", H.tok, { id: A_ID, category: "OTHER", label: "Zzz Alpha document", helpText: "Updated help", isMandatory: false });
  ok("HR edits it (optional now)", upd.s === 200 && upd.b.requirement.isMandatory === false && upd.b.requirement.helpText === "Updated help");
  await call("POST", "/onboarding/requirements", H.tok, { id: A_ID, category: "OTHER", label: "Zzz Alpha document", isMandatory: true });
  await sleep(1200);
  const aud = (await q(`select action,summary,before,after from audit_logs where path='/api/onboarding/requirements' and "recordId"=$1 order by "createdAt"`, [A_ID]));
  ok("every change is in the audit log with before/after", aud.length >= 3 && aud[0].action === "CREATE" && aud.some((r) => r.action === "UPDATE" && r.before && "isMandatory" in r.before && r.before.isMandatory === true && r.after.isMandatory === false), aud.map((r) => [r.action, r.before, r.after]));

  console.log("\n## 2. The employee's own checklist");
  const mine0 = (await call("GET", "/documents/mine", E.tok)).b;
  ok("an employee sees required documents with a status for each", mine0.items.length > 0 && mine0.items.every((i) => ["NOT_SUBMITTED", "SUBMITTED", "VERIFIED", "REJECTED"].includes(i.status) && i.name), mine0.items?.[0]);
  ok("nothing is submitted yet: everything required is 'missing'", mine0.summary.missing === mine0.summary.required && mine0.summary.required === base + 1 + 1, [mine0.summary, base]);
  ok("someone with no employment type set sees EVERY requirement (as before)", mine0.items.some((i) => i.name === "Zzz Intern only") && mine0.employmentType === null);
  ok("API labels are the four plain words", mine0.items.every((i) => ["Not submitted", "Submitted", "Verified", "Rejected"].includes(i.statusLabel)));
  ok("no token -> 401", (await call("GET", "/documents/mine")).s === 401);

  console.log("\n## 3. Employment type decides what applies");
  ok("employee cannot set employment types -> 403", (await call("POST", `/documents/employees/${E.id}/employment-type`, E.tok, { employmentType: "INTERN" })).s === 403);
  ok("manager cannot -> 403", (await call("POST", `/documents/employees/${E.id}/employment-type`, M.tok, { employmentType: "INTERN" })).s === 403);
  ok("HR of another company -> 404", (await call("POST", `/documents/employees/${E.id}/employment-type`, X.tok, { employmentType: "INTERN" })).s === 404);
  ok("invalid type -> 400", (await call("POST", `/documents/employees/${E.id}/employment-type`, H.tok, { employmentType: "WIZARD" })).s === 400);
  ok("garbage id -> 404", (await call("POST", `/documents/employees/not-a-uuid/employment-type`, H.tok, { employmentType: "INTERN" })).s === 404);
  ok("HR sets PERMANENT", (await call("POST", `/documents/employees/${E.id}/employment-type`, H.tok, { employmentType: "PERMANENT" })).b.employmentType === "PERMANENT");
  const mineP = (await call("GET", "/documents/mine", E.tok)).b;
  ok("a permanent employee no longer sees the intern-only requirement, and it is not counted", !mineP.items.some((i) => i.name === "Zzz Intern only") && mineP.summary.required === base + 1, mineP.summary);
  await call("POST", `/documents/employees/${E.id}/employment-type`, H.tok, { employmentType: "INTERN" });
  ok("an intern sees it", (await call("GET", "/documents/mine", E.tok)).b.items.some((i) => i.name === "Zzz Intern only"));
  await call("POST", `/documents/employees/${E.id}/employment-type`, H.tok, { employmentType: "PERMANENT" });
  await sleep(1200);
  const et = (await q(`select action,before,after,"targetUserId" from audit_logs where path=$1 order by "createdAt" desc limit 1`, [`/api/documents/employees/${E.id}/employment-type`]))[0];
  ok("the change is audited with before/after", et && et.before.employmentType === "INTERN" && et.after.employmentType === "PERMANENT" && et.targetUserId === E.id, et);

  console.log("\n## 4. Submitting, reviewing, rejecting");
  const up = await call("POST", "/onboarding/me/documents", E.tok, { requirementId: A_ID, fileName: "alpha.pdf", data: PDF, mimeType: "application/pdf" });
  ok("employee uploads a document for a requirement -> SUBMITTED", up.s === 200, up);
  const after1 = (await call("GET", "/documents/mine", E.tok)).b;
  const alpha = after1.items.find((i) => i.name === "Zzz Alpha document");
  ok("it now reads 'Submitted' and the missing count drops by one", alpha.status === "SUBMITTED" && after1.summary.missing === mineP.summary.missing - 1 && after1.summary.submitted === 1, [alpha, after1.summary]);
  ok("a not-applicable requirement cannot receive a file -> 400", (await call("POST", "/onboarding/me/documents", E.tok, { requirementId: B_ID, fileName: "x.pdf", data: PDF, mimeType: "application/pdf" })).s === 400);
  ok("an executable file type is refused -> 415", (await call("POST", "/onboarding/me/documents", E.tok, { requirementId: A_ID, fileName: "x.html", data: Buffer.from("<script>").toString("base64"), mimeType: "text/html" })).s === 415);
  const tr = (await call("GET", "/documents/tracking", H.tok)).b;
  const me = tr.rows.find((r) => r.employeeCode === "DOC-E");
  ok("HR tracking shows the person with required / pending / missing counts", me && me.submitted === 1 && me.missing === after1.summary.missing && me.employmentType === "PERMANENT" && me.complete === false, me);
  ok("tracking totals count people needing attention", tr.totals.people >= 2 && tr.totals.withPending >= 1 && tr.totals.withMissing >= 1, tr.totals);
  ok("filter: pending review", (await call("GET", "/documents/tracking?status=pending", H.tok)).b.rows.every((r) => r.submitted > 0) && (await call("GET", "/documents/tracking?status=pending", H.tok)).b.rows.some((r) => r.employeeCode === "DOC-E"));
  ok("filter: missing", (await call("GET", "/documents/tracking?status=missing", H.tok)).b.rows.every((r) => r.missing > 0));
  ok("filter: search by employee ID", (await call("GET", "/documents/tracking?q=DOC-E2", H.tok)).b.rows.every((r) => r.employeeCode === "DOC-E2"));
  ok("filter: by employment type, and unspecified", (await call("GET", "/documents/tracking?employmentType=PERMANENT", H.tok)).b.rows.every((r) => r.employmentType === "PERMANENT") && (await call("GET", "/documents/tracking?employmentType=UNSPECIFIED", H.tok)).b.rows.every((r) => !r.employmentType));
  ok("bad filter value -> 400; bad status is ignored, never 500", (await call("GET", "/documents/tracking?employmentType=NOPE", H.tok)).s === 400 && (await call("GET", "/documents/tracking?status=zzz", H.tok)).s === 200);
  ok("employee/manager cannot open tracking -> 403", (await call("GET", "/documents/tracking", E.tok)).s === 403 && (await call("GET", "/documents/tracking", M.tok)).s === 403);
  ok("HR of another company sees none of these people", (await call("GET", "/documents/tracking?q=DOC-", X.tok)).b.rows.every((r) => !String(r.employeeCode).startsWith("DOC-E")));
  const chk = (await call("GET", `/documents/employees/${E.id}`, H.tok)).b;
  const docId = chk.items.find((i) => i.name === "Zzz Alpha document").documentId;
  ok("HR opens the person's checklist with each document's id", chk.employee.employeeCode === "DOC-E" && docId);
  ok("employee cannot open someone else's checklist -> 403", (await call("GET", `/documents/employees/${E2.id}`, E.tok)).s === 403);
  ok("HR of another company -> 404", (await call("GET", `/documents/employees/${E.id}`, X.tok)).s === 404);
  const f = await fetch(API + `/onboarding/documents/${docId}/file`, { headers: { authorization: "Bearer " + H.tok } });
  ok("HR can open the submitted file (private)", f.status === 200 && (await f.text()).startsWith("%PDF") && /no-store/.test(f.headers.get("cache-control") ?? ""));
  ok("another employee cannot open it", (await fetch(API + `/onboarding/documents/${docId}/file`, { headers: { authorization: "Bearer " + E2.tok } })).status >= 400);
  ok("rejecting without a reason -> 400", (await call("POST", `/onboarding/documents/${docId}/review`, H.tok, { approve: false })).s === 400);
  ok("HR rejects with a reason", (await call("POST", `/onboarding/documents/${docId}/review`, H.tok, { approve: false, rejectionReason: "The scan is unreadable" })).s === 200);
  const rej = (await call("GET", "/documents/mine", E.tok)).b.items.find((i) => i.name === "Zzz Alpha document");
  ok("the employee sees 'Rejected' and the reason", rej.status === "REJECTED" && rej.rejectionReason === "The scan is unreadable" && rej.reviewedBy, rej);
  await call("POST", "/onboarding/me/documents", E.tok, { requirementId: A_ID, fileName: "alpha2.pdf", data: PDF, mimeType: "application/pdf" });
  const again = (await call("GET", "/documents/mine", E.tok)).b.items.find((i) => i.name === "Zzz Alpha document");
  ok("re-uploading puts it back to 'Submitted' and clears the old reason", again.status === "SUBMITTED" && again.rejectionReason === null && again.fileName === "alpha2.pdf", again);
  ok("employee cannot review (verify) their own document -> 403", (await call("POST", `/onboarding/documents/${docId}/review`, E.tok, { approve: true })).s === 403);
  ok("manager cannot review -> 403", (await call("POST", `/onboarding/documents/${docId}/review`, M.tok, { approve: true })).s === 403);
  ok("HR of another company cannot review -> 404", (await call("POST", `/onboarding/documents/${docId}/review`, X.tok, { approve: true })).s === 404);
  ok("HR verifies it", (await call("POST", `/onboarding/documents/${docId}/review`, H.tok, { approve: true })).s === 200);
  const ver = (await call("GET", "/documents/mine", E.tok)).b;
  ok("the employee sees 'Verified'", ver.items.find((i) => i.name === "Zzz Alpha document").status === "VERIFIED" && ver.summary.verified === 1);
  await sleep(1200);
  const rv = (await q(`select action,before,after,"targetUserId" from audit_logs where path=$1 order by "createdAt"`, [`/api/onboarding/documents/${docId}/review`]));
  ok("review decisions are audited with before/after and the employee", rv.length >= 2 && rv.some((r) => r.action === "REJECT" && r.after.rejectionReason === "The scan is unreadable" && r.targetUserId === E.id) && rv.some((r) => r.action === "APPROVE" && r.before.status === "SUBMITTED" && r.after.status === "APPROVED"), rv.map((r) => [r.action, r.before, r.after]));

  console.log("\n## 5. Deactivating keeps every file");
  const dbefore = (await q(`select count(*)::int n from employee_documents where id=$1 and "storageKey" is not null`, [docId]))[0].n;
  ok("HR deactivates the requirement", (await call("POST", "/onboarding/requirements", H.tok, { id: A_ID, category: "OTHER", label: "Zzz Alpha document", isActive: false })).s === 200);
  const arch = (await call("GET", "/documents/mine", E.tok)).b;
  ok("it disappears from what the employee must submit", !arch.items.some((i) => i.name === "Zzz Alpha document"));
  ok("...but the submitted file is listed as 'no longer required', not lost", arch.archived.some((x) => x.name === "Zzz Alpha document" && x.status === "VERIFIED" && /No longer required/.test(x.reason)), arch.archived);
  ok("the document row and its stored file still exist", dbefore === 1 && (await q(`select count(*)::int n from employee_documents where id=$1 and "storageKey" is not null`, [docId]))[0].n === 1);
  const f2 = await fetch(API + `/onboarding/documents/${docId}/file`, { headers: { authorization: "Bearer " + H.tok } });
  ok("HR can still open the file", f2.status === 200);
  ok("a deactivated requirement refuses new uploads -> 400", (await call("POST", "/onboarding/me/documents", E.tok, { requirementId: A_ID, fileName: "z.pdf", data: PDF, mimeType: "application/pdf" })).s === 400);
  ok("it no longer counts as missing for anyone", !((await call("GET", "/documents/tracking?q=DOC-E2", H.tok)).b.rows[0].missing > (await call("GET", "/documents/mine", E2.tok)).b.summary.required));
  const cfg = (await call("GET", "/onboarding/requirements", H.tok)).b.requirements.find((r) => r.id === A_ID);
  ok("HR still sees it (inactive) with its counts, and can re-activate it", cfg && cfg.isActive === false && cfg.verified === 1 && (await call("POST", "/onboarding/requirements", H.tok, { id: A_ID, category: "OTHER", label: "Zzz Alpha document", isActive: true })).s === 200);

  console.log("\n## 6. Existing joiner flow still works with scoping");
  const cand = await call("GET", "/onboarding/candidates", H.tok);
  ok("the joiner list still loads", cand.s === 200 && Array.isArray(cand.b.candidates));
  const me2 = await call("GET", "/onboarding/me", E.tok);
  ok("the joiner checklist endpoint still answers", me2.s === 200);

  await wipe();
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
