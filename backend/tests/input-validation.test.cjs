// Bad input on WRITE endpoints must come back as a 4xx with a message, never a 500.
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const API = (process.env.TEST_API ?? "http://localhost:5002/api");
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);
const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  let j; try { j = await r.json(); } catch { j = null; } return { s: r.status, b: j };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 250))); };
(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const login = async (e, p) => (await call("POST", "/auth/login", null, { email: e, password: p })).b.token;
  const HR = await login("qa.hr@avatarindia.com", "QaHr@12345678"), EMP = await login("priya@avatarindia.com", process.env.TEST_PW_EMPLOYEE), ADM = await login("admin@avatarindia.com", process.env.TEST_PW_ADMIN);
  await db.query(`delete from users where email like 'val-%@example.com'`);
  const sanitized = async (name, p) => { const r = await p; ok(name + " -> handled (no 500)", r.s < 500, r); return r; };
  const no500 = async (name, p) => { const r = await p; ok(name + " -> 4xx, not 500", r.s >= 400 && r.s < 500, r); return r; };

  console.log("## malformed JSON and empty bodies");
  const raw = await fetch(API + "/leave/requests", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + EMP }, body: "{not json" });
  ok("malformed JSON body -> 400, not 500", raw.status === 400, raw.status);
  for (const [m, p] of [["POST", "/leave/requests"], ["POST", "/policies"], ["POST", "/companies"], ["POST", "/tickets"], ["POST", "/admin/users"]]) await no500(`${m} ${p} with empty body`, call(m, p, p === "/admin/users" ? HR : EMP, {}));

  console.log("\n## dates and times");
  await no500("onboarding hire with a garbage joining date", call("POST", "/onboarding/hires", HR, { firstName: "V", lastName: "T", email: "val-a@example.com", temporaryPassword: "Temp@1234567", dateOfJoining: "garbage" }));
  await no500("admin create user with garbage joining date", call("POST", "/admin/users", HR, { firstName: "V", lastName: "T", email: "val-b@example.com", password: "Temp@1234567", dateOfJoining: "31/12/2026" }));
  await no500("ticket correction with a garbage time", call("POST", "/tickets", EMP, { category: "ATTENDANCE_CORRECTION", subject: "x", description: "y", correctionDate: "2026-10-20", requestedLoginAt: "not a time" }));
  await no500("ticket correction with an impossible date", call("POST", "/tickets", EMP, { category: "ATTENDANCE_CORRECTION", subject: "x", description: "y", correctionDate: "2026-02-31", requestedLoginAt: "2026-10-20T09:00:00Z" }));
  const cand = (await db.query(`select id from users where "platformId"=(select "platformId" from users where email='qa.hr@avatarindia.com') and role='EMPLOYEE' limit 1`)).rows[0].id;
  await no500("offer with an impossible joining date (2026-02-31)", call("POST", "/offers", HR, { candidateId: cand, roleTitle: "Analyst", joiningDate: "2026-02-31" }));
  await no500("offer with a garbage expiry date", call("POST", "/offers", HR, { candidateId: cand, roleTitle: "Analyst", joiningDate: "2026-12-01", expiresAt: "garbage" }));
  await no500("holiday with an impossible date", call("POST", "/holidays", ADM, { date: "2026-02-31", name: "X" }));
  await no500("leave with an impossible date", call("POST", "/leave/requests", EMP, { from: "2026-02-31", leaveType: "CASUAL", reason: "abc" }));
  await no500("admin leave marking with an impossible date", call("POST", "/admin/leave", HR, { userId: cand, from: "2026-13-01" }));
  await no500("payroll month 13", call("GET", "/payroll/month?month=13&year=2026", ADM));
  await no500("payroll upload with month 0", call("POST", "/payroll/upload", ADM, { userId: cand, month: 0, year: 2026, fileName: "a.pdf", data: "JVBERi0=", mimeType: "application/pdf" }));

  console.log("\n## numbers, enums and ids in bodies");
  await no500("ticket with an unknown category", call("POST", "/tickets", EMP, { category: "NOPE", subject: "x", description: "y" }));
  await sanitized("task with a huge weight and bad status (values are whitelisted)", call("POST", "/tasks", EMP, { title: "t", weight: 1e12, priority: "???" }));
  await no500("meeting invite to a garbage user id", call("POST", "/tracker/invites", HR, { userIds: ["not-a-uuid"], meetingType: "TEAM" }));
  await no500("team member add with a garbage user id", call("POST", `/admin/teams/${"00000000-0000-0000-0000-000000000000"}/members`, HR, { userId: "not-a-uuid" }));
  await no500("password reset for a non-uuid body id", call("PATCH", `/admin/users/${"00000000-0000-0000-0000-000000000000"}`, HR, { reportsToId: "not-a-uuid" }));
  await no500("project with garbage manager id", call("POST", "/projects", HR, { name: "ValTest", managerId: "not-a-uuid" }));

  console.log("\n## files");
  await no500("upload with invalid base64", call("POST", "/policies", HR, { category: "IT_POLICY", title: "TEST bad", fileName: "a.pdf", data: "%%%%", mimeType: "application/pdf" }));
  await sanitized("upload with a path-like file name (stored as a plain label)", call("POST", "/policies", HR, { category: "IT_POLICY", title: "TEST bad2", fileName: "../../etc/passwd.pdf", data: "JVBERi0=", mimeType: "application/pdf" }));
  const leaked = (await db.query(`select "fileName" from induction_documents where title='TEST bad2'`)).rows;
  ok("a path-like file name is stored as a harmless label", leaked.every((r) => !/[\\/]/.test(r.fileName)), leaked);

  await db.query(`delete from users where email like 'val-%@example.com'`);
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
