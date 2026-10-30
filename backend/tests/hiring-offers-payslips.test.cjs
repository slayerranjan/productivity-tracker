const { Client } = require("pg");
const API = (process.env.TEST_API ?? "http://localhost:5002/api");
const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j };
};
const login = async (e, p) => (await call("POST", "/auth/login", null, { email: e, password: p })).b;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 400))); };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
(async () => {
  require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  await db.query(`delete from users where email like 'hiretest%@example.com'`);
  await db.query(`delete from salary_slips where month=9 and year=2026 and "userId"=(select id from users where email='priya@avatarindia.com')`);
  const HR = (await login("qa.hr@avatarindia.com", "QaHr@12345678")).token;
  const ADM = (await login("admin@avatarindia.com", process.env.TEST_PW_ADMIN)).token;
  const EMP = (await login("priya@avatarindia.com", process.env.TEST_PW_EMPLOYEE)).token;
  ok("logins work", HR && ADM && EMP);

  console.log("\n## Joining");
  ok("employee cannot create a hire -> 403", (await call("POST", "/onboarding/hires", EMP, { firstName: "A", lastName: "B", email: "hiretest0@example.com", temporaryPassword: "Temp@1234567" })).s === 403);
  const h = await call("POST", "/onboarding/hires", HR, { firstName: "Hire", lastName: "Test", email: "hiretest1@example.com", designation: "Analyst", temporaryPassword: "Temp@1234567" });
  ok("HR adds a joiner: account + employee code created in one step", h.s === 201 && h.b.credentials?.employeeCode && h.b.user?.id, h);
  ok("welcome email outcome is reported and never blocks creation (no SMTP here)", h.b.mail && typeof h.b.mail === "object", h.b.mail);
  const code = h.b.credentials.employeeCode, uid = h.b.user.id;
  ok("duplicate email -> 409", (await call("POST", "/onboarding/hires", HR, { firstName: "Hire", lastName: "Test", email: "hiretest1@example.com", temporaryPassword: "Temp@1234567" })).s === 409);
  ok("weak password -> 400", (await call("POST", "/onboarding/hires", HR, { firstName: "Hire", lastName: "Two", email: "hiretest2@example.com", temporaryPassword: "abc" })).s === 400);
  const cl = await call("GET", "/onboarding/candidates", HR);
  ok("HR sees the joiner in the pipeline", cl.s === 200 && cl.b.candidates.some((c) => c.id === uid), cl.s);
  const C = await login(code, "Temp@1234567");
  ok("joiner signs in with the employee CODE", !!C.token, C);
  ok("joiner must change password first", C.user?.mustChangePassword === true, C.user);
  ok("tracker is LOCKED until the file is complete", [403].includes((await call("GET", "/tracker/session", C.token)).s));
  const me0 = await call("GET", "/onboarding/me", C.token);
  ok("joiner sees their checklist", me0.s === 200, me0);
  const reqs = (await call("GET", "/onboarding/requirements", HR)).b;
  const list = Array.isArray(reqs) ? reqs : reqs.requirements ?? [];
  const empReqs = list.filter((r) => r.uploadedByEmployee && r.isMandatory !== false);
  const hrReqs = list.filter((r) => !r.uploadedByEmployee && r.isMandatory !== false);
  ok("document requirements exist (employee + HR side)", empReqs.length > 0, Object.keys(list[0] ?? {}));
  console.log("   employee uploads:", empReqs.length, "| HR uploads:", hrReqs.length);

  for (const r of empReqs) {
    const up = await call("POST", "/onboarding/me/documents", C.token, { requirementId: r.id, fileName: "doc.pdf", data: PDF, mimeType: "application/pdf" });
    if (up.s !== 200) { ok("joiner uploads " + (r.name ?? r.label ?? r.id), false, up); break; }
  }
  const afterUp = (await call("GET", "/onboarding/candidates/" + uid, HR)).b;
  console.log("   candidate keys:", Object.keys(afterUp).join(","));
  const docs = (afterUp.checklist ?? []).filter((c) => c.id).map((c) => ({ id: c.id, requirementId: c.requirementId }));
  ok("all uploaded, waiting for HR (48h clock starts)", docs.length >= empReqs.length, { docs: docs.length });
  const st1 = (await db.query(`select "onboardingStatus" s from users where id=$1`, [uid])).rows[0].s;
  ok("status is DOCUMENTS_SUBMITTED", st1 === "DOCUMENTS_SUBMITTED", st1);
  const pct = (x) => x.progress?.percent ?? x.progressPercent ?? x.progress;
  console.log("   progress before approvals:", JSON.stringify(afterUp.user.progress ?? Object.keys(afterUp.user)));
  const bad = docs.find((d) => d.id);
  const rej = await call("POST", `/onboarding/documents/${bad.id}/review`, HR, { approve: false, rejectionReason: "Photo is blurry" });
  ok("HR rejects a document with a reason", rej.s === 200, rej);
  const noReason = await call("POST", `/onboarding/documents/${docs[1]?.id ?? bad.id}/review`, HR, { approve: false });
  ok("rejecting WITHOUT a reason is refused", noReason.s === 400, noReason);
  const me1 = await call("GET", "/onboarding/me", C.token);
  ok("joiner sees the rejection reason", JSON.stringify(me1.b).includes("Photo is blurry"), me1.s);
  ok("tracker still locked", (await call("GET", "/tracker/session", C.token)).s === 403);
  const re = await call("POST", "/onboarding/me/documents", C.token, { requirementId: bad.requirementId ?? empReqs[0].id, fileName: "doc2.pdf", data: PDF, mimeType: "application/pdf" });
  ok("joiner can re-upload after rejection", re.s === 200, re);
  const fresh = (await call("GET", "/onboarding/candidates/" + uid, HR)).b.checklist.filter((c) => c.id && c.requirementId);
  for (const d of fresh) { const a = await call("POST", `/onboarding/documents/${d.id}/review`, HR, { approve: true }); if (a.s !== 200) { ok("HR approves doc", false, a); break; } }
  const st2 = (await db.query(`select "onboardingStatus" s from users where id=$1`, [uid])).rows[0].s;
  ok("all approved -> AWAITING_RESUME (still locked)", st2 === "AWAITING_RESUME" && (await call("GET", "/tracker/session", C.token)).s === 403, st2);
  for (const r of hrReqs) {
    const u = await call("POST", `/onboarding/candidates/${uid}/documents`, HR, { requirementId: r.id, fileName: "hr.pdf", data: PDF, mimeType: "application/pdf" });
    if (u.s !== 200) { ok("HR uploads their file", false, u); break; }
  }
  const st3 = (await db.query(`select "onboardingStatus" s, "trackerAccessEnabled" t from users where id=$1`, [uid])).rows[0];
  ok("file complete -> ACTIVE and tracker unlocked", st3.s === "ACTIVE" && st3.t === true, st3);
  const pw = await call("POST", "/onboarding/me/password", C.token, { currentPassword: "Temp@1234567", newPassword: "Mine@Secret123" });
  const C2 = await login(code, "Mine@Secret123");
  ok("joiner sets their own password and signs in with it", !!C2.token, [pw.s, C2]);
  ok("tracker now opens for the joiner", C2.token && (await call("GET", "/tracker/session", C2.token)).s === 200);
  const dl = await fetch(API + `/onboarding/documents/${fresh[0].id}/file`, { headers: { authorization: "Bearer " + EMP } });
  ok("another employee cannot read the joiner's identity papers", dl.status === 403 || dl.status === 404, dl.status);

  console.log("\n## Offers");
  const cand2 = await call("POST", "/onboarding/hires", HR, { firstName: "Offer", lastName: "Person", email: "hiretest3@example.com", temporaryPassword: "Temp@1234567" });
  const tpl = await call("POST", "/offers/templates", HR, { name: "Test letter " + Date.now(), subject: "Offer for {{name}}", bodyHtml: "<p>Dear {{name}}, role {{role}}</p>" });
  ok("HR saves an offer template", tpl.s === 200 || tpl.s === 201, tpl);
  const tplId = tpl.b.id ?? tpl.b.template?.id;
  const off = await call("POST", "/offers", HR, { candidateId: cand2.b.user.id, templateId: tplId, roleTitle: "Analyst", joiningDate: "2026-12-01", ctcAnnual: 600000 });
  ok("offer is created from the template (fields filled in)", off.s === 200 || off.s === 201, off);
  const offId = off.b.offerId;
  const sent = await call("POST", `/offers/${offId}/send`, HR);
  ok("offer is sent (email outcome reported, never throws)", sent.s === 200, sent);
  await call("POST", "/offers/templates", HR, { id: tplId, name: "Test letter " + Date.now() + "b", subject: "CHANGED {{name}}", bodyHtml: "<p>CHANGED FORMAT</p>" });
  const view = await call("GET", `/offers/${offId}`, HR);
  ok("editing the template later does NOT change the letter already sent", view.s === 200 && JSON.stringify(view.b).includes("Dear") && !JSON.stringify(view.b).includes("CHANGED FORMAT"), view);
  const tp = sent.b.temporaryPassword ?? sent.b.account?.temporaryPassword ?? sent.b.credentials?.temporaryPassword; console.log("   sent keys:", Object.keys(sent.b).join(), "| temp pw returned when mail not sent:", !!tp); const OCL = await login(cand2.b.credentials.employeeCode, tp ?? "Temp@1234567"); console.log("   offer-candidate login:", JSON.stringify(OCL).slice(0,160)); const OC = OCL.token;
  const mine = await call("GET", "/offers/me", OC);
  ok("candidate sees their offer", mine.s === 200, mine);
  const ac = await call("POST", `/offers/me/${offId}/respond`, OC, { accept: true });
  ok("candidate accepts online and it is recorded", ac.s === 200, ac);
  const rec = (await db.query(`select status from offers where id=$1`, [offId])).rows[0];
  ok("database records ACCEPTED", rec?.status === "ACCEPTED", rec);
  ok("answering twice is refused", (await call("POST", `/offers/me/${offId}/respond`, OC, { accept: false })).s >= 400);

  console.log("\n## Payslips");
  const priya = (await db.query(`select id from users where email='priya@avatarindia.com'`)).rows[0].id;
  const rahulTok = (await login("rahul@avatarindia.com", process.env.TEST_PW_EMPLOYEE)).token;
  const up = await call("POST", "/payroll/upload", ADM, { userId: priya, month: 9, year: 2026, fileName: "slip.pdf", data: PDF, mimeType: "application/pdf" });
  ok("admin uploads a payslip for one person", up.s === 200, up);
  const m1 = await call("GET", "/payroll/me", EMP);
  ok("unpublished slip is invisible to the employee", m1.s === 200 && JSON.stringify(m1.b).indexOf("slip.pdf") === -1 || (m1.b.slips ?? []).length === 0, m1.b);
  const slipId = (await db.query(`select id from salary_slips where "userId"=$1 and month=9 and year=2026`, [priya])).rows[0]?.id;
  const pub = await call("POST", "/payroll/publish", ADM, { slipIds: [slipId], publish: true });
  ok("publishing is a separate deliberate step", pub.s === 200, pub);
  const m2 = await call("GET", "/payroll/me", EMP);
  ok("published slip is visible to its owner", JSON.stringify(m2.b).includes(slipId), m2.b);
  const d1 = await fetch(API + `/payroll/${slipId}/download`, { headers: { authorization: "Bearer " + EMP } });
  const d2 = await fetch(API + `/payroll/${slipId}/download`, { headers: { authorization: "Bearer " + rahulTok } });
  ok("owner downloads it", d1.status === 200, d1.status);
  const d2b = await d2.text(); ok("another employee cannot reach it (denied, no file)", d2.status >= 400 && !d2b.startsWith("%PDF"), [d2.status, d2b.slice(0,120)]);
  ok("employee cannot upload/publish slips -> 403", (await call("POST", "/payroll/upload", EMP, { userId: priya, month: 9, year: 2026, fileName: "x.pdf", data: PDF })).s === 403);

  console.log("\n## Audit & projects");
  const au = (await db.query(`select count(*)::int n from audit_logs`)).rows[0].n;
  ok("audit log has entries (who/what/when)", au > 0, au);
  const pr = await call("GET", "/projects", HR);
  ok("projects list loads for HR", pr.s === 200, pr.s);
  const mgr = (await login("manager@avatarindia.com", process.env.TEST_PW_MANAGER)).token;
  ok("manager can read projects they run", (await call("GET", "/projects", mgr)).s === 200);
  ok("employee cannot read projects -> 403", (await call("GET", "/projects", EMP)).s === 403);

  await db.query(`delete from users where email like 'hiretest%@example.com'`);
  await db.query(`delete from salary_slips where "userId"=$1 and month=9 and year=2026`, [priya]);
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
