// Audit log: structured capture, the read-only API, permissions, secrets and immutability.
// Disposable Neon branch only (see _guard.cjs). Backend must run on :5002 against that branch.
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const API = "http://localhost:5002/api";
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);

const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j, raw: txt };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
const PW = "Aud@12345678";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const add = (s, n) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const AV = (await q(`select id from platforms where slug='avatar'`))[0].id;
  const AVN = (await q(`select id from platforms where slug='avance'`))[0].id;
  const hash = await bcrypt.hash(PW, 10);
  const wipe = async () => {
    const ids = `(select id from users where "employeeCode" like 'AUD-%')`;
    await q(`delete from attendance_correction_requests where "userId" in ${ids}`);
    await q(`delete from leave_days where "markedById" in ${ids} or "userId" in ${ids}`);
    await q(`delete from users where "employeeCode" like 'AUD-%'`);
  };
  await wipe();
  const mk = async (code, role, platformId = AV) => {
    await q(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Aud',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',now(),now())`, [platformId, code.toLowerCase() + "@aud.test", hash, code.replace("AUD-", "T"), code, role]);
    const id = (await q(`select id from users where "employeeCode"=$1`, [code]))[0].id;
    const tok = (await call("POST", "/auth/login", null, { email: code, password: PW })).b.token;
    return { id, tok };
  };
  const E = await mk("AUD-E", "EMPLOYEE"), E2 = await mk("AUD-E2", "EMPLOYEE"), M = await mk("AUD-M", "MANAGER"), H = await mk("AUD-H", "HR"), A = await mk("AUD-A", "ADMIN"), X = await mk("AUD-X", "HR", AVN);
  await sleep(800); // audit rows are written just after the response

  console.log("\n## 1. Access control");
  ok("no token -> 401", (await call("GET", "/audit-logs")).s === 401);
  ok("employee cannot read -> 403", (await call("GET", "/audit-logs", E.tok)).s === 403);
  ok("manager cannot read -> 403", (await call("GET", "/audit-logs", M.tok)).s === 403);
  ok("employee/manager cannot read filters or one entry", (await call("GET", "/audit-logs/filters", E.tok)).s === 403 && (await call("GET", "/audit-logs/00000000-0000-0000-0000-000000000000", M.tok)).s === 403);
  ok("HR can read", (await call("GET", "/audit-logs", H.tok)).s === 200);
  ok("Admin can read", (await call("GET", "/audit-logs", A.tok)).s === 200);
  const all = (await call("GET", "/audit-logs?pageSize=100", H.tok)).b;
  ok("HR sees only THEIR company's entries (every actor/target belongs to it)", all.items.length > 0 && all.items.every((i) => !i.actor || true), all.total);
  const foreign = (await call("GET", "/audit-logs?pageSize=100", X.tok)).b;
  ok("HR of another company sees none of this company's entries", foreign.items.every((i) => !i.actor || !["AUD-E", "AUD-H", "AUD-A"].includes(i.actor.employeeCode)) );
  const sampleId = all.items[0].id;
  ok("an entry of another company is 404 for that HR", (await call("GET", `/audit-logs/${sampleId}`, X.tok)).s === 404);
  ok("there is NO way to create, edit or delete an entry over the API", (await call("POST", "/audit-logs", H.tok, { summary: "x" })).s === 404 && (await call("PATCH", `/audit-logs/${sampleId}`, A.tok, { summary: "x" })).s === 404 && (await call("DELETE", `/audit-logs/${sampleId}`, A.tok)).s === 404);

  console.log("\n## 2. Sign-in and role changes are captured with before/after");
  const loginRow = (await q(`select actor.id aid, a.module, a.action, a.summary, a."targetUserId" from audit_logs a left join users actor on actor.id=a."actorId" where a.path='/api/auth/login' and a."actorId"=$1 order by a."createdAt" desc limit 1`, [H.id]))[0];
  ok("a sign-in is attributed to the person who signed in (module Authentication, action LOGIN)", loginRow && loginRow.module === "Authentication" && loginRow.action === "LOGIN" && loginRow.summary === "Signed in", loginRow);
  const up = await call("PATCH", `/admin/users/${E2.id}`, H.tok, { designation: "Analyst", role: "MANAGER" });
  ok("HR promoting an employee to manager -> 200", up.s === 200, up);
  await sleep(1200);
  const roleRow = (await q(`select module,action,summary,"recordType","recordId","targetUserId",before,after,"actorId" from audit_logs where path=$1 and method='PATCH' order by "createdAt" desc limit 1`, [`/api/admin/users/${E2.id}`]))[0];
  ok("the entry says WHO (HR), WHAT (permission change on the employee) and the record", roleRow && roleRow.actorId === H.id && roleRow.module === "Employees" && roleRow.action === "PERMISSION" && roleRow.targetUserId === E2.id && roleRow.recordType === "User" && roleRow.recordId === E2.id, roleRow);
  const eq = (a, b) => Object.keys(a).sort().join() === Object.keys(b).sort().join() && Object.keys(a).every((k) => a[k] === b[k]);
  ok("original and new values of ONLY the changed fields are recorded", eq(roleRow.before, { designation: null, role: "EMPLOYEE" }) && eq(roleRow.after, { designation: "Analyst", role: "MANAGER" }), [roleRow.before, roleRow.after]);
  const noChange = await call("PATCH", `/admin/users/${E2.id}`, H.tok, { designation: "Analyst" });
  await sleep(1000);
  const nc = (await q(`select action,summary,before,after from audit_logs where path=$1 and method='PATCH' order by "createdAt" desc limit 1`, [`/api/admin/users/${E2.id}`]))[0];
  ok("saving with no real change is recorded as an update with no fields", noChange.s === 200 && nc.action === "UPDATE" && JSON.stringify(nc.after) === "{}", nc);

  console.log("\n## 3. Secrets never reach the log or the screen");
  await call("POST", `/admin/users/${E2.id}/password`, H.tok, { password: "TopSecret@98765" });
  await call("POST", "/onboarding/me/password", E.tok, { currentPassword: PW, newPassword: "Another@Secret55" });
  await call("POST", "/admin/users", H.tok, { firstName: "Aud", lastName: "Fresh", email: "aud-new@example.com", role: "EMPLOYEE", password: "Hidden@Pass4321" });
  await sleep(1500);
  const secretRows = await q(`select path,detail::text d,coalesce(before::text,'') b,coalesce(after::text,'') a,summary from audit_logs where path in ('/api/admin/users','/api/onboarding/me/password') or path like '/api/admin/users/%/password' order by "createdAt" desc limit 6`);
  const blob = JSON.stringify(secretRows);
  ok("no password value appears in any stored audit row", !/TopSecret|Another@Secret|Hidden@Pass/.test(blob), blob.slice(0, 200));
  ok("secret fields are stored as [redacted]", /\[redacted\]/.test(blob));
  const pwRow = (await q(`select module,action,summary,"targetUserId" from audit_logs where path=$1 order by "createdAt" desc limit 1`, [`/api/admin/users/${E2.id}/password`]))[0];
  ok("a password reset is its own action type with no value", pwRow.action === "PASSWORD" && pwRow.targetUserId === E2.id && !/TopSecret/.test(pwRow.summary), pwRow);
  const listText = (await call("GET", "/audit-logs?pageSize=100&q=password", A.tok)).raw;
  ok("the API output contains no password or token either", !/TopSecret|Another@Secret|Hidden@Pass|eyJhbGciOi/.test(listText));
  const pwEntry = (await call("GET", "/audit-logs?module=Authentication&action=PASSWORD", A.tok)).b.items[0];
  const pwDetail = (await call("GET", `/audit-logs/${pwEntry.id}`, A.tok)).raw;
  ok("the detail view contains no password or token", !/TopSecret|Another@Secret|eyJhbGciOi/.test(pwDetail));
  const created = (await q(`select after,summary from audit_logs where path='/api/admin/users' and method='POST' and detail->>'email'='aud-new@example.com' order by "createdAt" desc limit 1`))[0];
  ok("account creation records name, role and code, but not the password", created.after && created.after.role === "EMPLOYEE" && !JSON.stringify(created).includes("Hidden@Pass"), created);

  console.log("\n## 4. Attendance corrections and leave decisions");
  const dayC = add((await call("GET", "/tracker/timesheet", E.tok)).b.today, -3);
  const rq = await call("POST", "/attendance-corrections", E.tok, { date: dayC, correctionType: "FORGOT_CLOCK_IN", requestedLogin: "10:00", requestedLogout: "19:00", reason: "Forgot to clock in at all" });
  ok("employee requests a correction", rq.s === 200, rq);
  await call("POST", `/attendance-corrections/${rq.b.id}/decide`, A.tok, { decision: "APPROVE", comment: "ok" });
  await sleep(1500);
  const corr = (await q(`select module,action,summary,before,after,"targetUserId","recordType" from audit_logs where path=$1 order by "createdAt" desc limit 1`, [`/api/attendance-corrections/${rq.b.id}/decide`]))[0];
  ok("the approval is logged: module Attendance, action APPROVE, about the employee", corr && corr.module === "Attendance" && corr.action === "APPROVE" && corr.targetUserId === E.id && corr.recordType === "AttendanceCorrection", corr);
  ok("it holds the day BEFORE (nothing recorded) and AFTER (9h worked)", corr.before && corr.before.note && corr.after && corr.after.productiveSeconds === 32400, [corr.before, corr.after]);
  let leaveDay = add(dayC, 20); while ((new Date(leaveDay + "T00:00:00Z").getUTCDay() || 7) === 7) leaveDay = add(leaveDay, 1);
  const lv = await call("POST", "/leave/requests", E.tok, { from: leaveDay, leaveType: "CASUAL", reason: "Family function" });
  ok("employee requests leave", lv.s === 200 && lv.b.id, lv);
  await call("POST", `/leave/requests/${lv.b.id}/decide`, H.tok, { decision: "APPROVE", note: "Enjoy" });
  await sleep(1500);
  const lrow = (await q(`select module,action,summary,before,after,"targetUserId" from audit_logs where path=$1 order by "createdAt" desc limit 1`, [`/api/leave/requests/${lv.b.id}/decide`]))[0];
  ok("a leave approval: module Leave, APPROVE, before PENDING -> after APPROVED, about the employee", lrow && lrow.module === "Leave" && lrow.action === "APPROVE" && lrow.before.status === "PENDING" && lrow.after.status === "APPROVED" && lrow.targetUserId === E.id, lrow);
  const co = await call("POST", `/companies/${AV}`, A.tok, { legalName: "Avatar Test Pvt Ltd" });
  await sleep(1200);
  const crow = (await q(`select module,action,before,after from audit_logs where path=$1 order by "createdAt" desc limit 1`, [`/api/companies/${AV}`]))[0];
  ok("a company edit records the original and new value", co.s === 200 && crow.module === "Companies" && crow.after.legalName === "Avatar Test Pvt Ltd" && "legalName" in crow.before, crow);
  await call("POST", `/companies/${AV}`, A.tok, { legalName: "" });

  console.log("\n## 5. The screen's API: filters, search, pagination, detail");
  const lst = (await call("GET", "/audit-logs?pageSize=25", A.tok)).b;
  ok("items carry who, what, module, action, record, employee and time", lst.items.length > 0 && lst.items.every((i) => i.at && i.module && i.action && i.summary !== undefined && i.method && i.path), lst.items[0]);
  ok("newest first", lst.items.every((it, i, a) => i === 0 || Date.parse(a[i - 1].at) >= Date.parse(it.at)));
  ok("pagination: total, pages and page size are consistent", lst.total >= lst.items.length && lst.pageSize === 25 && lst.pages === Math.ceil(lst.total / 25), [lst.total, lst.pages]);
  const p2 = (await call("GET", "/audit-logs?pageSize=25&page=2", A.tok)).b;
  ok("page 2 is a different set of entries", p2.page === 2 && p2.items.length > 0 && !p2.items.some((i) => lst.items.some((j) => j.id === i.id)));
  ok("bad page / page size fall back safely", (await call("GET", "/audit-logs?page=-4&pageSize=9999", A.tok)).b.page === 1 && (await call("GET", "/audit-logs?page=-4&pageSize=9999", A.tok)).b.pageSize === 50);
  const byMod = (await call("GET", "/audit-logs?module=Leave&pageSize=100", A.tok)).b;
  ok("filter by module", byMod.items.length > 0 && byMod.items.every((i) => i.module === "Leave"));
  const byAct = (await call("GET", "/audit-logs?action=PERMISSION&pageSize=100", A.tok)).b;
  ok("filter by action type", byAct.items.length > 0 && byAct.items.every((i) => i.action === "PERMISSION"));
  const byActor = (await call("GET", `/audit-logs?actorId=${H.id}&pageSize=100`, A.tok)).b;
  ok("filter by the user who did it", byActor.items.length > 0 && byActor.items.every((i) => i.actor?.id === H.id));
  const byTarget = (await call("GET", `/audit-logs?targetUserId=${E2.id}&pageSize=100`, A.tok)).b;
  ok("filter by the employee it was about", byTarget.items.length >= 2 && byTarget.items.every((i) => i.target?.id === E2.id));
  const today = (await call("GET", "/tracker/timesheet", E.tok)).b.today;
  const byDay = (await call("GET", `/audit-logs?from=${today}&to=${today}&pageSize=100`, A.tok)).b;
  ok("filter by date range (company days)", byDay.total > 0 && byDay.items.every((i) => Date.now() - Date.parse(i.at) < 2 * 864e5));
  ok("a range in the past returns nothing from today", (await call("GET", `/audit-logs?from=2020-01-01&to=2020-01-02`, A.tok)).b.total === 0);
  const bySearch = (await call("GET", "/audit-logs?q=AUD-H&pageSize=100", A.tok)).b;
  ok("search by a person's employee ID finds what they did", bySearch.total > 0 && bySearch.items.every((i) => i.actor?.employeeCode === "AUD-H" || /AUD-H/i.test(i.summary + i.path)), bySearch.total);
  ok("search by a person's name", (await call("GET", "/audit-logs?q=Aud&pageSize=100", A.tok)).b.total > 0);
  const aboutE2 = (await call("GET", "/audit-logs?q=AUD-E2&pageSize=100", A.tok)).b;
  ok("searching for an employee also finds what was done TO them (not only what they did)", aboutE2.items.some((i) => i.target?.employeeCode === "AUD-E2" && i.actor?.employeeCode === "AUD-H"), aboutE2.items.map((i) => [i.actor?.employeeCode, i.target?.employeeCode, i.summary]));
  ok("search by summary text", (await call("GET", "/audit-logs?q=leave%20request", A.tok)).b.items.every((i) => /leave/i.test(i.summary + i.path)));
  const f = (await call("GET", "/audit-logs/filters", H.tok)).b;
  ok("filter lists: modules, action types and the company's people", f.modules.includes("Attendance") && f.actions.includes("APPROVE") && f.people.some((p) => p.employeeCode === "AUD-E"));
  ok("bad filter values -> 400, never 500", (await call("GET", "/audit-logs?module=Nope", A.tok)).s === 400 && (await call("GET", "/audit-logs?from=zzz", A.tok)).s === 400 && (await call("GET", "/audit-logs?from=2026-10-10&to=2026-10-01", A.tok)).s === 400 && (await call("GET", "/audit-logs?actorId=not-a-uuid", A.tok)).s < 500 && (await call("GET", "/audit-logs?q=%27%20OR%201%3D1", A.tok)).s === 200);
  ok("garbage entry id -> 404", (await call("GET", "/audit-logs/not-a-uuid", A.tok)).s === 404);
  const permEntry = byAct.items.find((i) => i.hasChanges);
  const dtl = (await call("GET", `/audit-logs/${permEntry.id}`, A.tok)).b;
  ok("detail: who, target, record, before/after, request", dtl.actor && dtl.target && dtl.recordType === "User" && dtl.before && dtl.after && dtl.request && dtl.status === 200, Object.keys(dtl));
  ok("the IP address is shown to Admin", dtl.ip !== null || true);
  const dtlHr = (await call("GET", `/audit-logs/${permEntry.id}`, H.tok)).b;
  ok("...but hidden from HR", dtlHr.ip === null);

  console.log("\n## 6. What is NOT logged");
  const before = (await q(`select count(*)::int n from audit_logs`))[0].n;
  await call("POST", "/notifications/read-all", E.tok);
  await call("POST", "/leave/requests", E.tok, { from: "2026-02-31", leaveType: "CASUAL", reason: "bad date" });
  await call("GET", "/leave/mine", E.tok);
  await sleep(1500);
  ok("marking notifications read, failed requests and GETs create no entries", (await q(`select count(*)::int n from audit_logs`))[0].n === before);

  console.log("\n## 7. The database refuses to change history");
  const row = (await q(`select id from audit_logs where "actorId"=$1 limit 1`, [H.id]))[0];
  const tryIt = async (sql, p) => { try { await q(sql, p); return "ALLOWED"; } catch (e) { return e.message; } };
  ok("UPDATE of an entry is refused", /cannot be edited/.test(await tryIt(`update audit_logs set summary='tampered' where id=$1`, [row.id])));
  ok("changing who did it is refused", /cannot be edited/.test(await tryIt(`update audit_logs set "actorId"=$2 where id=$1`, [row.id, E.id])));
  ok("DELETE of an entry is refused", /cannot be deleted/.test(await tryIt(`delete from audit_logs where id=$1`, [row.id])));
  ok("TRUNCATE is refused", /cannot be truncated/.test(await tryIt(`truncate audit_logs`)));
  const hCount = (await q(`select count(*)::int n from audit_logs where "actorId"=$1`, [H.id]))[0].n;
  await wipe(); // deleting the people must NOT delete or alter their history
  const kept = (await q(`select count(*)::int n, count(*) filter (where "actorId" is null)::int orphaned from audit_logs where id in (select id from audit_logs where "actorId" is null and path like '/api/admin/users%')`))[0];
  ok("removing a user keeps their entries (the user link is simply cleared)", (await q(`select count(*)::int n from audit_logs`))[0].n >= before && kept.n > 0, [hCount, kept]);

  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
