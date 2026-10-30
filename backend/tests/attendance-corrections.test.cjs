// Attendance correction workflow, end to end over HTTP + direct database checks.
// Disposable Neon branch only (see _guard.cjs). Backend must run on :5002 against that branch.
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const API = "http://localhost:5002/api";
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);

const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
const add = (s, n) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
const ist = (d, hm) => new Date(`${d}T${hm}:00+05:30`).toISOString();
const PW = "Corr@12345678";

(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const AV = (await q(`select id from platforms where slug='avatar'`))[0].id;
  const AVN = (await q(`select id from platforms where slug='avance'`))[0].id;
  const shiftId = (await q(`select id from shifts where "platformId"=$1 and "startTime"='10:00' limit 1`, [AV]))[0]?.id;
  const teamId = (await q(`select id from teams where "platformId"=$1 and "isActive" limit 1`, [AV]))[0]?.id;
  const hash = await bcrypt.hash(PW, 10);
  const wipe = async () => {
    const ids = `(select id from users where "employeeCode" like 'COR-%')`;
    await q(`delete from attendance_correction_requests where "userId" in ${ids}`);
    await q(`delete from leave_days where "markedById" in ${ids} or "userId" in ${ids}`);
    await q(`delete from tickets where "raisedById" in ${ids}`);
    await q(`delete from users where "employeeCode" like 'COR-%'`);
  };
  await wipe();
  const mk = async (code, role, platformId = AV) => {
    await q(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","shiftId","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Corr',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',$7,now(),now())`, [platformId, code.toLowerCase() + "@corr.test", hash, code.replace("COR-", "T"), code, role, platformId === AV ? shiftId : null]);
    const id = (await q(`select id from users where "employeeCode"=$1`, [code]))[0].id;
    const tok = (await call("POST", "/auth/login", null, { email: code, password: PW })).b.token;
    return { id, tok };
  };
  const E = await mk("COR-E", "EMPLOYEE"), E2 = await mk("COR-E2", "EMPLOYEE"), M = await mk("COR-M", "MANAGER");
  const H = await mk("COR-H", "HR"), H2 = await mk("COR-H2", "HR"), A = await mk("COR-A", "ADMIN"), X = await mk("COR-X", "HR", AVN);
  if (teamId) await q(`insert into team_members (id,"teamId","userId","isActive","isPrimary","joinedAt") values (gen_random_uuid(),$1,$2,true,true,now())`, [teamId, E.id]).catch(() => {});
  const today = (await call("GET", "/tracker/timesheet", E.tok)).b.today;
  const D = (n) => add(today, -n);
  const seedSession = async (user, date, login, logout, opts = {}) => {
    const late = opts.late ?? 0;
    const r = await q(`insert into work_sessions (id,"platformId","userId",date,"loginAt","logoutAt",status,"productiveSeconds","breakSeconds","meetingSeconds","wasLateLogin","lateByMinutes","shiftStartTime","autoClosed","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,'10:00',$11,now(),now()) returning id`, [AV, user, date, ist(date, login), logout ? ist(date, logout) : null, logout ? "COMPLETED" : "ACTIVE", opts.prod ?? 0, opts.brk ?? 0, late > 0, late, opts.autoClosed === true]);
    for (const [s, e] of opts.breaks ?? []) await q(`insert into tracker_breaks (id,"workSessionId","breakType","startedAt","endedAt","durationSeconds","autoClosed","createdAt") values (gen_random_uuid(),$1,'LUNCH',$2,$3,$4,false,now())`, [r[0].id, ist(date, s), ist(date, e), Math.round((Date.parse(ist(date, e)) - Date.parse(ist(date, s))) / 1000)]);
    return r[0].id;
  };
  const TS = (c) => `to_char("${c}", 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')`;
  const sess = async (user, date) => (await q(`select ${TS("loginAt")} as "loginAt", ${TS("logoutAt")} as "logoutAt",status,"autoClosed","productiveSeconds","breakSeconds","wasLateLogin","lateByMinutes","shiftStartTime" from work_sessions where "userId"=$1 and date=$2`, [user, date]))[0];
  const submit = (t, body) => call("POST", "/attendance-corrections", t, body);
  const reqRow = async (id) => (await q(`select status,"reviewedById","reviewedAt","reviewComment","appliedAt" from attendance_correction_requests where id=$1`, [id]))[0];

  console.log("\n## 1. Missing clock-in: employee asks, HR approves, record is created");
  const d1 = D(5);
  await q(`insert into alerts (id,"platformId","userId","alertType",severity,date,message,"createdAt") values (gen_random_uuid(),$1,$2,'NO_LOGIN','WARNING',$3,'No login',now())`, [AV, E.id, d1]);
  ok("no attendance exists for that day yet", !(await sess(E.id, d1)));
  const r1 = await submit(E.tok, { date: d1, correctionType: "MISSING_CHECKIN", requestedLogin: "10:00", requestedLogout: "19:00", reason: "Biometric machine did not scan me in" });
  ok("employee submits the request -> 200 PENDING", r1.s === 200 && r1.b.status === "PENDING", r1);
  ok("submitting changes NOTHING in attendance", !(await sess(E.id, d1)));
  ok("the request is saved with the employee and date", (await reqRow(r1.b.id))?.status === "PENDING");
  const notif = await q(`select "userId",type,body,link from notifications where data->>'requestId'=$1`, [r1.b.id]);
  const expectHr = (await q(`select id from users where "platformId"=$1 and role in ('HR','ADMIN') and status='ACTIVE' and id<>$2`, [AV, E.id])).map((r) => r.id).sort();
  ok("every active HR/Admin of the company is notified (not the requester, not the other company, not the manager)", JSON.stringify(notif.map((n) => n.userId).sort()) === JSON.stringify(expectHr) && expectHr.length >= 3 && notif.every((n) => n.type === "CORRECTION_SUBMITTED") && !notif.some((n) => [E.id, X.id, M.id].includes(n.userId)), [notif.length, expectHr.length]);
  ok("the notification carries name, ID, date, type, recorded, requested, reason", /Corr T/.test(notif[0].body) && notif[0].body.includes("COR-E") && notif[0].body.includes(d1) && /Missing check-in/.test(notif[0].body) && /No attendance recorded/.test(notif[0].body) && /10:00 AM/.test(notif[0].body) && /biometric/i.test(notif[0].body), notif[0].body);
  const hn = await call("GET", "/notifications", H2.tok);
  ok("HR sees it in the inbox with an unread count and a link", hn.b.unread >= 1 && hn.b.items.some((i) => i.link === `/dashboard/corrections?id=${r1.b.id}`), hn.b);
  ok("pending badge count for HR is 1+", (await call("GET", "/attendance-corrections/pending-count", H2.tok)).b.pending >= 1);
  ok("the requester got no notification about their own request", (await call("GET", "/notifications", E.tok)).b.items.every((i) => i.type !== "CORRECTION_SUBMITTED"));
  const ap1 = await call("POST", `/attendance-corrections/${r1.b.id}/decide`, H2.tok, { decision: "APPROVE", comment: "Verified with the biometric log" });
  ok("HR approves -> APPROVED", ap1.s === 200 && ap1.b.status === "APPROVED", ap1);
  const s1 = await sess(E.id, d1);
  ok("a completed attendance record now exists with the approved times", s1 && s1.status === "COMPLETED" && s1.loginAt === ist(d1, "10:00") && s1.logoutAt === ist(d1, "19:00"), s1);
  ok("worked hours recalculated by the existing rule (9h on site, no breaks = 32400s)", s1.productiveSeconds === 32400 && s1.breakSeconds === 0, s1);
  ok("not late (10:00 is within the shift + 15 min grace)", s1.wasLateLogin === false && s1.lateByMinutes === 0, s1);
  ok("the shift start was recorded on the new session", s1.shiftStartTime === "10:00");
  ok("the stale NO_LOGIN alert for that day was removed", (await q(`select count(*)::int n from alerts where "userId"=$1 and date=$2 and "alertType"='NO_LOGIN'`, [E.id, d1]))[0].n === 0);
  const rr1 = await reqRow(r1.b.id);
  ok("reviewer, review time, decision and comment are recorded", rr1.reviewedById === H2.id && rr1.reviewedAt && rr1.status === "APPROVED" && rr1.reviewComment === "Verified with the biometric log" && rr1.appliedAt, rr1);
  const au1 = await q(`select action,before,after,"actedById" from attendance_correction_audits where "requestId"=$1`, [r1.b.id]);
  ok("one audit row records who applied it and the before/after", au1.length === 1 && au1[0].actedById === H2.id && au1[0].before.note && au1[0].after.productiveSeconds === 32400, au1);
  const en = await call("GET", "/notifications", E.tok);
  ok("the employee is notified of the decision with HR's comment", en.b.items.some((i) => i.type === "CORRECTION_DECIDED" && /approved/i.test(i.title) && i.body.includes("Verified with the biometric log")), en.b.items);
  ok("approving the same request again is refused (409), no second audit row", (await call("POST", `/attendance-corrections/${r1.b.id}/decide`, H2.tok, { decision: "APPROVE" })).s === 409 && (await q(`select count(*)::int n from attendance_correction_audits where "requestId"=$1`, [r1.b.id]))[0].n === 1);

  console.log("\n## 2. Wrong time: worked hours and late status recalculate, original is preserved");
  const d2 = D(4);
  const sid2 = await seedSession(E.id, d2, "10:50", "19:00", { prod: 28200, brk: 1800, late: 35, breaks: [["13:00", "13:30"]] });
  await q(`insert into alerts (id,"platformId","userId","alertType",severity,date,message,"createdAt") values (gen_random_uuid(),$1,$2,'LATE_LOGIN','WARNING',$3,'Late',now())`, [AV, E.id, d2]);
  const r2 = await submit(E.tok, { date: d2, correctionType: "BIOMETRIC_FAILURE", requestedLogin: "10:10", reason: "Machine rejected my finger at 10:05, retried at 10:50" });
  ok("a request for a 2-4 minute style issue is just a normal request (pending, nothing auto-changed)", r2.s === 200 && (await sess(E.id, d2)).wasLateLogin === true && (await sess(E.id, d2)).lateByMinutes === 35);
  ok("the request snapshots the recorded times at submission", (await q(`select ${TS("originalLoginAt")} as o from attendance_correction_requests where id=$1`, [r2.b.id]))[0].o === ist(d2, "10:50"));
  await call("POST", `/attendance-corrections/${r2.b.id}/decide`, H.tok, { decision: "APPROVE", comment: "ok" });
  const s2 = await sess(E.id, d2);
  ok("login corrected; logout and breaks untouched", s2.loginAt === ist(d2, "10:10") && s2.logoutAt === ist(d2, "19:00"), s2);
  ok("productive = on site (10:10-19:00 = 8h50m) minus the 30m break = 30000s", s2.productiveSeconds === 30000 && s2.breakSeconds === 1800, s2);
  ok("late mark removed because 10:10 is within the existing 15-minute grace (rule unchanged)", s2.wasLateLogin === false && s2.lateByMinutes === 0, s2);
  ok("the stale LATE_LOGIN alert was removed", (await q(`select count(*)::int n from alerts where "userId"=$1 and date=$2 and "alertType"='LATE_LOGIN'`, [E.id, d2]))[0].n === 0);
  const det = await call("GET", `/attendance-corrections/${r2.b.id}`, H.tok);
  ok("audit history keeps the ORIGINAL (late 35, 28200s) and the corrected values", det.s === 200 && det.b.audits.length === 1 && det.b.audits[0].before.lateByMinutes === 35 && det.b.audits[0].before.productiveSeconds === 28200 && det.b.audits[0].before.wasLateLogin === true && det.b.audits[0].after.lateByMinutes === 0 && det.b.audits[0].after.productiveSeconds === 30000 && new Date(det.b.audits[0].before.loginAt).toISOString() === ist(d2, "10:50") && det.b.audits[0].by.startsWith("Corr"), det.b.audits);
  ok("details show original vs requested vs current, side by side", det.b.originalLoginAt && det.b.requestedLoginAt && det.b.current?.loginAt && det.b.employee.employeeCode === "COR-E");
  console.log("\n## 3. Consistency: reports, timesheet and history show the corrected values");
  const rep = (await call("GET", `/reports?from=${d2}&to=${d2}&groupBy=person&userId=${E.id}`, H.tok)).b;
  ok("Reports: productive seconds and late days match the corrected record", rep.people?.[0]?.productiveSeconds === 30000 && rep.people[0].lateDays === 0, rep.people?.[0]);
  const ts = (await call("GET", `/tracker/timesheet?from=${d2}&to=${d2}`, E.tok)).b;
  ok("Timesheet: corrected times, totals and a 'corrected' marker naming who did it", ts.days[0].session.productiveSeconds === 30000 && ts.days[0].session.wasLateLogin === false && ts.days[0].session.correction?.by?.startsWith("Corr"), ts.days[0].session);
  const hist = (await call("GET", `/tracker/history?from=${d2}&to=${d2}`, E.tok)).b;
  ok("History: same corrected figures", hist.rows?.[0]?.productiveSeconds === 30000 || hist.summary?.totalProductive === 30000, hist.summary);

  console.log("\n## 4. A corrected time that is STILL past the grace stays late (nothing is waived)");
  const d3 = D(3);
  await seedSession(E.id, d3, "11:00", "19:00", { prod: 28800, late: 45 });
  const r3 = await submit(E.tok, { date: d3, correctionType: "INCORRECT_TIME", requestedLogin: "10:20", reason: "Clocked in late by mistake, arrived 10:20" });
  await call("POST", `/attendance-corrections/${r3.b.id}/decide`, H.tok, { decision: "APPROVE" });
  const s3 = await sess(E.id, d3);
  ok("10:20 = 5 minutes past 10:15 grace -> still late by 5", s3.wasLateLogin === true && s3.lateByMinutes === 5 && s3.productiveSeconds === 31200, s3);

  console.log("\n## 5. Rejection leaves attendance untouched");
  const d4 = D(2);
  await seedSession(E.id, d4, "10:30", "18:00", { prod: 27000, late: 15 });
  const before4 = await sess(E.id, d4);
  const r4 = await submit(E.tok, { date: d4, correctionType: "INCORRECT_TIME", requestedLogin: "09:00", reason: "I think I came earlier" });
  ok("rejecting without a reason -> 400", (await call("POST", `/attendance-corrections/${r4.b.id}/decide`, H.tok, { decision: "REJECT" })).s === 400);
  ok("request still pending after the refused rejection", (await reqRow(r4.b.id)).status === "PENDING");
  const rj = await call("POST", `/attendance-corrections/${r4.b.id}/decide`, H.tok, { decision: "REJECT", comment: "No evidence of an earlier arrival" });
  ok("HR rejects with a reason -> REJECTED", rj.s === 200 && rj.b.status === "REJECTED", rj);
  ok("attendance record is exactly as before", JSON.stringify(await sess(E.id, d4)) === JSON.stringify(before4));
  ok("no audit row is written for a rejection", (await q(`select count(*)::int n from attendance_correction_audits where "requestId"=$1`, [r4.b.id]))[0].n === 0);
  const rr4 = await reqRow(r4.b.id);
  ok("reviewer, time and comment recorded on the rejection", rr4.reviewedById === H.id && rr4.reviewedAt && rr4.reviewComment === "No evidence of an earlier arrival" && rr4.appliedAt === null, rr4);
  ok("the employee sees status and HR's comment", (await call("GET", "/attendance-corrections/mine", E.tok)).b.requests.some((x) => x.id === r4.b.id && x.status === "REJECTED" && x.reviewComment === "No evidence of an earlier arrival" && x.reviewedBy));
  ok("after a rejection the employee may ask again for the same day", (await submit(E.tok, { date: d4, correctionType: "INCORRECT_TIME", requestedLogin: "10:00", reason: "Here is the correct time" })).s === 200);

  console.log("\n## 6. Missing check-out on an auto-closed day");
  const d5 = D(6);
  await seedSession(E.id, d5, "10:00", "23:59", { prod: 50000, autoClosed: true });
  const r5 = await submit(E.tok, { date: d5, correctionType: "MISSING_CHECKOUT", requestedLogout: "18:30", reason: "Forgot to clock out" });
  await call("POST", `/attendance-corrections/${r5.b.id}/decide`, A.tok, { decision: "APPROVE" });
  const s5 = await sess(E.id, d5);
  ok("logout corrected, no longer 'auto-closed', worked time = 8h30m", s5.logoutAt === ist(d5, "18:30") && s5.autoClosed === false && s5.status === "COMPLETED" && s5.productiveSeconds === 30600, s5);
  ok("Admin can approve too", (await reqRow(r5.b.id)).reviewedById === A.id);

  console.log("\n## 7. Permissions (enforced by the server)");
  const d6 = D(7);
  const rp = await submit(E2.tok, { date: d6, correctionType: "FORGOT_CLOCK_IN", requestedLogin: "10:00", requestedLogout: "18:00", reason: "Forgot to clock in at all" });
  ok("another employee submits a request", rp.s === 200, rp);
  ok("an employee cannot approve their own request -> 403", (await call("POST", `/attendance-corrections/${rp.b.id}/decide`, E2.tok, { decision: "APPROVE" })).s === 403);
  ok("an employee cannot approve someone else's request -> 403", (await call("POST", `/attendance-corrections/${rp.b.id}/decide`, E.tok, { decision: "APPROVE" })).s === 403);
  ok("a MANAGER cannot approve -> 403", (await call("POST", `/attendance-corrections/${rp.b.id}/decide`, M.tok, { decision: "APPROVE" })).s === 403);
  ok("a manager cannot open the review list or the badge -> 403", (await call("GET", "/attendance-corrections", M.tok)).s === 403 && (await call("GET", "/attendance-corrections/pending-count", M.tok)).s === 403);
  ok("an employee cannot open the review list -> 403", (await call("GET", "/attendance-corrections", E.tok)).s === 403);
  ok("HR from ANOTHER company cannot decide it -> 404", (await call("POST", `/attendance-corrections/${rp.b.id}/decide`, X.tok, { decision: "APPROVE" })).s === 404);
  ok("HR from another company sees none of this company's requests", (await call("GET", "/attendance-corrections", X.tok)).b.requests.length === 0 && (await call("GET", `/attendance-corrections/${rp.b.id}`, X.tok)).s === 404);
  ok("an employee cannot read another employee's request -> 404", (await call("GET", `/attendance-corrections/${rp.b.id}`, E.tok)).s === 404);
  ok("an employee can read their own request", (await call("GET", `/attendance-corrections/${rp.b.id}`, E2.tok)).s === 200);
  ok("HR cannot approve THEIR OWN request -> 403", await (async () => { const own = await submit(H.tok, { date: D(8), correctionType: "FORGOT_CLOCK_IN", requestedLogin: "10:00", requestedLogout: "18:00", reason: "HR forgot to clock in" }); return (await call("POST", `/attendance-corrections/${own.b.id}/decide`, H.tok, { decision: "APPROVE" })).s === 403 && (await call("POST", `/attendance-corrections/${own.b.id}/decide`, H2.tok, { decision: "REJECT", comment: "test cleanup" })).s === 200; })());
  ok("no token -> 401", (await call("GET", "/attendance-corrections/mine")).s === 401 && (await call("POST", "/attendance-corrections", null, {})).s === 401);
  ok("garbage ids -> 404, not 500", (await call("GET", "/attendance-corrections/not-a-uuid", H.tok)).s === 404 && (await call("POST", "/attendance-corrections/not-a-uuid/decide", H.tok, { decision: "APPROVE" })).s === 404);
  ok("employees cannot change attendance directly: no route accepts it (session untouched)", (await call("PATCH", "/tracker/session", E.tok, { loginAt: new Date().toISOString() })).s === 404);
  ok("cancel: only the owner, only while pending", (await call("POST", `/attendance-corrections/${rp.b.id}/cancel`, E.tok)).s === 404 && (await call("POST", `/attendance-corrections/${rp.b.id}/cancel`, E2.tok)).s === 200 && (await call("POST", `/attendance-corrections/${rp.b.id}/cancel`, E2.tok)).s === 400);

  console.log("\n## 8. Validation, duplicates and conflicts");
  const bad = async (name, body, status) => { const r = await submit(E.tok, { reason: "A genuine reason", correctionType: "INCORRECT_TIME", ...body }); ok(name, r.s === status, r); return r; };
  const dv = D(9);
  await bad("future date -> 400", { date: add(today, 1), requestedLogin: "10:00" }, 400);
  await bad("older than 30 days -> 400", { date: D(45), requestedLogin: "10:00", requestedLogout: "18:00" }, 400);
  await bad("impossible date -> 400", { date: "2026-02-31", requestedLogin: "10:00" }, 400);
  await bad("bad time format -> 400", { date: dv, requestedLogin: "25:99", requestedLogout: "18:00" }, 400);
  await bad("no times at all -> 400", { date: dv }, 400);
  await bad("short reason -> 400", { date: dv, requestedLogin: "10:00", requestedLogout: "18:00", reason: "no" }, 400);
  await bad("unknown type -> 400", { date: dv, correctionType: "NOPE", requestedLogin: "10:00", requestedLogout: "18:00" }, 400);
  await bad("logout before login -> 400", { date: dv, requestedLogin: "18:00", requestedLogout: "10:00" }, 400);
  await bad("missing check-in type without a login time -> 400", { date: dv, correctionType: "MISSING_CHECKIN", requestedLogout: "18:00" }, 400);
  await bad("no attendance that day and only a login -> 400", { date: dv, requestedLogin: "10:00" }, 400);
  await bad("non-text value in a text field -> 400", { date: dv, requestedLogin: 1000 }, 400);
  const dl = D(10);
  await q(`insert into leave_days (id,"platformId","userId",date,"leaveType","isHalfDay","isFirstHalf","markedById","createdAt") values (gen_random_uuid(),$1,$2,$3,'SICK',false,true,$4,now())`, [AV, E.id, dl, A.id]);
  await bad("a day on full leave -> 400", { date: dl, requestedLogin: "10:00", requestedLogout: "18:00" }, 400);
  const db1 = D(11);
  await seedSession(E.id, db1, "10:00", "19:00", { prod: 30000, brk: 3600, breaks: [["13:00", "14:00"]] });
  await bad("a login after the recorded break started -> 409", { date: db1, requestedLogin: "13:30" }, 409);
  await bad("a logout before the recorded break ended -> 409", { date: db1, requestedLogout: "13:30" }, 409);
  const dupDay = D(12);
  const f1 = await submit(E.tok, { date: dupDay, correctionType: "FORGOT_CLOCK_IN", requestedLogin: "10:00", requestedLogout: "18:00", reason: "First request here" });
  const f2 = await submit(E.tok, { date: dupDay, correctionType: "FORGOT_CLOCK_IN", requestedLogin: "10:05", requestedLogout: "18:00", reason: "Second request here" });
  ok("a second pending request for the same day -> 409", f1.s === 200 && f2.s === 409, [f1.s, f2.s]);
  const race = await Promise.all([1, 2, 3].map(() => submit(E2.tok, { date: D(13), correctionType: "FORGOT_CLOCK_IN", requestedLogin: "10:00", requestedLogout: "18:00", reason: "Racing duplicate" })));
  ok("three simultaneous submissions for one day create exactly ONE (database-enforced)", race.filter((r) => r.s === 200).length === 1 && (await q(`select count(*)::int n from attendance_correction_requests where "userId"=$1 and date=$2 and status='PENDING'`, [E2.id, D(13)]))[0].n === 1, race.map((r) => r.s));
  const dt = today;
  await q(`delete from work_sessions where "userId"=$1 and date=$2`, [E.id, dt]);
  await seedSession(E.id, dt, "09:00", null, {});
  ok("today's still-running session cannot be closed through a correction -> 400", (await submit(E.tok, { date: dt, correctionType: "MISSING_CHECKOUT", requestedLogout: "10:00", reason: "Trying to close today" })).s === 400);
  await q(`delete from work_sessions where "userId"=$1 and date=$2`, [E.id, dt]);

  console.log("\n## 9. Concurrent approvals and a session that changed after the request");
  const dc = D(14);
  const rc = await submit(E.tok, { date: dc, correctionType: "MISSING_CHECKIN", requestedLogin: "10:00", requestedLogout: "18:00", reason: "Concurrency test case" });
  const both = await Promise.all([call("POST", `/attendance-corrections/${rc.b.id}/decide`, H.tok, { decision: "APPROVE" }), call("POST", `/attendance-corrections/${rc.b.id}/decide`, H2.tok, { decision: "APPROVE" }), call("POST", `/attendance-corrections/${rc.b.id}/decide`, A.tok, { decision: "REJECT", comment: "racing" })]);
  const codes = both.map((r) => r.s).sort();
  ok("three reviewers at once: exactly one decision wins, the others get 409", codes.filter((c) => c === 200).length === 1 && codes.filter((c) => c === 409).length === 2, codes);
  const wonApprove = (await reqRow(rc.b.id)).status === "APPROVED";
  ok("the database agrees with the winner: one audit row if approved, none if rejected", (await q(`select count(*)::int n from attendance_correction_audits where "requestId"=$1`, [rc.b.id]))[0].n === (wonApprove ? 1 : 0));
  const dm = D(15);
  const rm = await submit(E.tok, { date: dm, correctionType: "MISSING_CHECKIN", requestedLogin: "10:00", requestedLogout: "18:00", reason: "Session will change meanwhile" });
  await seedSession(E.id, dm, "09:00", "18:00", { prod: 32400, breaks: [["09:30", "09:45"]] }); // someone/something recorded a break before 10:00
  const stale = await call("POST", `/attendance-corrections/${rm.b.id}/decide`, H.tok, { decision: "APPROVE" });
  ok("if the day changed so the correction no longer fits, approval fails safely (409) and the request stays PENDING", stale.s === 409 && (await reqRow(rm.b.id)).status === "PENDING" && (await q(`select count(*)::int n from attendance_correction_audits where "requestId"=$1`, [rm.b.id]))[0].n === 0, stale);
  ok("...and the attendance record was not touched", (await sess(E.id, dm)).loginAt === ist(dm, "09:00"));

  console.log("\n## 10. HR screen: filters, search, counts");
  const all = await call("GET", "/attendance-corrections", H.tok);
  ok("HR list returns requests with employee name/ID and counts per status", all.s === 200 && all.b.requests.length > 5 && all.b.requests[0].employee.employeeCode && all.b.counts.PENDING >= 1 && all.b.counts.APPROVED >= 4 && all.b.counts.REJECTED >= 1, all.b.counts);
  ok("filter by status", (await call("GET", "/attendance-corrections?status=REJECTED", H.tok)).b.requests.every((r) => r.status === "REJECTED"));
  ok("filter by date range", (await call("GET", `/attendance-corrections?from=${d1}&to=${d1}`, H.tok)).b.requests.every((r) => r.date === d1) && (await call("GET", `/attendance-corrections?from=${d1}&to=${d1}`, H.tok)).b.requests.length === 1);
  ok("search by employee ID", (await call("GET", "/attendance-corrections?q=COR-E2", H.tok)).b.requests.every((r) => r.employee.employeeCode === "COR-E2") && (await call("GET", "/attendance-corrections?q=COR-E2", H.tok)).b.requests.length >= 1);
  ok("search by name", (await call("GET", "/attendance-corrections?q=tE2", H.tok)).b.requests.length >= 1);
  if (teamId) ok("filter by team", (await call("GET", `/attendance-corrections?teamId=${teamId}`, H.tok)).b.requests.every((r) => r.employee.employeeCode === "COR-E") && (await call("GET", `/attendance-corrections?teamId=${teamId}`, H.tok)).b.requests.length >= 4);
  ok("bad filters never 500", (await call("GET", "/attendance-corrections?from=zzz", H.tok)).s === 400 && (await call("GET", "/attendance-corrections?teamId=not-a-uuid", H.tok)).s < 500);
  ok("HR dashboard badge count equals the pending count", (await call("GET", "/attendance-corrections/pending-count", H.tok)).b.pending === all.b.counts.PENDING);

  console.log("\n## 11. Evidence attachment and notifications");
  const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
  const ra = await submit(E.tok, { date: D(16), correctionType: "BIOMETRIC_FAILURE", requestedLogin: "10:00", requestedLogout: "18:00", reason: "Photo of the biometric error screen attached", attachment: { fileName: "error.pdf", data: PDF, mimeType: "application/pdf" } });
  ok("a PDF is accepted as evidence", ra.s === 200, ra);
  const f = await fetch(API + `/attendance-corrections/${ra.b.id}/attachment`, { headers: { authorization: "Bearer " + H.tok } });
  ok("HR can open the evidence (private, no-store)", f.status === 200 && (await f.text()).startsWith("%PDF") && /no-store/.test(f.headers.get("cache-control") ?? ""));
  ok("another employee cannot open it", (await fetch(API + `/attendance-corrections/${ra.b.id}/attachment`, { headers: { authorization: "Bearer " + E2.tok } })).status === 404);
  ok("an executable/HTML 'evidence' file is refused -> 415", (await submit(E.tok, { date: D(17), correctionType: "OTHER", requestedLogin: "10:00", requestedLogout: "18:00", reason: "Trying a bad file", attachment: { fileName: "x.html", data: Buffer.from("<script>").toString("base64"), mimeType: "text/html" } })).s === 415);
  const ni = (await call("GET", "/notifications", H.tok)).b;
  const one = ni.items.find((i) => !i.readAt);
  ok("HR marks one notification read; the unread count drops by one", one && (await call("POST", `/notifications/${one.id}/read`, H.tok)).b.updated === 1 && (await call("GET", "/notifications", H.tok)).b.unread === ni.unread - 1);
  ok("a person cannot mark someone else's notification read", (await call("POST", `/notifications/${one.id}/read`, E.tok)).b.updated === 0);
  ok("mark all read", (await call("POST", "/notifications/read-all", H.tok)).s === 200 && (await call("GET", "/notifications", H.tok)).b.unread === 0);

  console.log("\n## 12. Existing ticket path still works (kept by decision)");
  const tk = await call("POST", "/tickets", E.tok, { category: "ATTENDANCE_CORRECTION", subject: "Old style", description: "Using the ticket route", correctionDate: D(18), requestedLoginAt: ist(D(18), "10:00") });
  ok("an attendance-correction TICKET can still be raised", tk.s === 201, tk);

  // cleanup (cascades requests, audits, sessions, alerts, notifications)
  await wipe();
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
