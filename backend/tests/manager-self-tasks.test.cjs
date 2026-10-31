// Manager self-managed tasks: no approval for a manager's own tasks, the employee workflow untouched, start/complete/history,
// overdue, personal vs team productivity. Disposable Neon branch only (see _guard.cjs). Needs migration
// 20261101140000_manager_self_tasks applied there.
//
//   cd backend && TEST_DATABASE_URL=... TEST_API=http://localhost:5012/api node tests/manager-self-tasks.test.cjs
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const API = process.env.TEST_API ?? "http://localhost:5002/api";
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);

const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
const PW = "Self@12345678";
const add = (s, n) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const AV = (await q(`select id from platforms where slug='avatar'`))[0].id;
  const hash = await bcrypt.hash(PW, 10);
  const wipe = async () => {
    await q(`delete from daily_tasks where "userId" in (select id from users where "employeeCode" like 'SLF-%')`);
    await q(`delete from work_sessions where "userId" in (select id from users where "employeeCode" like 'SLF-%')`);
    await q(`delete from users where "employeeCode" like 'SLF-%'`);
  };
  await wipe();
  const mk = async (code, role, reportsTo = null) => {
    await q(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","reportsToId","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Slf',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',$7,now(),now())`, [AV, code.toLowerCase() + "@slf.test", hash, code.replace("SLF-", "T"), code, role, reportsTo]);
    const id = (await q(`select id from users where "employeeCode"=$1`, [code]))[0].id;
    const tok = (await call("POST", "/auth/login", null, { email: code, password: PW })).b.token;
    return { id, tok, code };
  };
  const ADM = await mk("SLF-ADM", "ADMIN");
  const M = await mk("SLF-M", "MANAGER", ADM.id); // a manager who reports to someone (like Ankit reports to Sanjay)
  const E = await mk("SLF-E", "EMPLOYEE", M.id);
  const H = await mk("SLF-H", "HR");
  const today = (await call("GET", "/tracker/timesheet", M.tok)).b.today;
  const taskRow = async (id) => (await q(`select * from daily_tasks where id=$1`, [id]))[0];
  const detailRow = async (id) => (await q(`select * from task_self_details where "taskId"=$1`, [id]))[0];
  const idOf = (payload, title) => payload.b.tasks.find((t) => t.title === title)?.id;

  console.log("\n## 1. A manager's own task needs no approval");
  const add1 = await call("POST", "/tasks", M.tok, { title: "Plan next week", description: "Roadmap", weight: "HIGH", dueDate: add(today, 2) });
  const t1 = idOf(add1, "Plan next week");
  ok("the manager adds a task", add1.s === 200 && t1, add1);
  const r1 = await taskRow(t1);
  ok("it is approved at once, under the manager's own name", r1.approvalStatus === "APPROVED" && r1.approvedById === M.id && r1.status === "PENDING", r1);
  ok("it is marked self-managed with its deadline", (await detailRow(t1))?.dueDate?.toISOString().slice(0, 10) === add(today, 2));
  ok("the screen is told this is self-managed mode and the task has no approval wording", add1.b.selfManagedMode === true && add1.b.awaitingApproval.length === 0 && add1.b.tasks.find((t) => t.id === t1).selfManaged === true, add1.b);
  ok("history has a 'created' entry", (await q(`select kind from task_events where "taskId"=$1`, [t1])).some((e) => e.kind === "CREATED"));

  console.log("\n## 2. Nobody else sees it, reviews it or is told about it");
  const qA = await call("GET", "/tasks/review/queue", ADM.tok);
  ok("the person he reports to does not see it in the review queue", !JSON.stringify(qA.b).includes(t1), qA.s);
  ok("no notification was created for anyone", (await q(`select 1 from notifications where data->>'taskId'=$1 or link like '%approvals%' and "createdAt" > now() - interval '1 minute'`, [t1])).length === 0);
  const tryApprove = await call("POST", `/tasks/review/${t1}/approve`, ADM.tok, { approve: true });
  ok("approving it directly is refused (409): it needs nobody's approval", tryApprove.s === 409, tryApprove);
  const tryGrade = await call("POST", `/tasks/review/${t1}/outcome`, ADM.tok, { outcome: "COMPLETED" });
  ok("grading it directly is refused too (409)", tryGrade.s === 409, tryGrade);
  ok("HR cannot read its history -> 404 (own tasks only)", (await call("GET", `/tasks/${t1}/history`, H.tok)).s === 404);

  console.log("\n## 3. Employees keep the approval workflow, unchanged");
  const addE = await call("POST", "/tasks", E.tok, { title: "Employee task", weight: "MEDIUM" });
  const tE = idOf(addE, "Employee task");
  const rE = await taskRow(tE);
  ok("an employee's task still waits for approval", rE.approvalStatus === "PENDING" && rE.approvedById === null, rE);
  ok("it is NOT self-managed", !(await detailRow(tE)) && addE.b.selfManagedMode === false && addE.b.awaitingApproval.length === 1);
  ok("the employee cannot give himself a deadline or work updates (manager-only)", (await call("PATCH", `/tasks/${tE}`, E.tok, { dueDate: add(today, 1) })).s === 400 && (await call("PATCH", `/tasks/${tE}`, E.tok, { workUpdate: "hello" })).s === 400);
  const qM = await call("GET", "/tasks/review/queue", M.tok);
  ok("his manager sees it in the review queue", JSON.stringify(qM.b).includes(tE));
  ok("his manager can approve it as before", (await call("POST", `/tasks/review/${tE}/approve`, M.tok, { approve: true })).s === 200 && (await taskRow(tE)).approvalStatus === "APPROVED");
  ok("an employee still cannot edit an approved task", (await call("PATCH", `/tasks/${tE}`, E.tok, { title: "Renamed" })).s === 400);

  console.log("\n## 4. Start, work updates, complete, history");
  ok("not started to start: In Progress sets the start time once", (await call("PATCH", `/tasks/${t1}`, M.tok, { status: "IN_PROGRESS" })).s === 200 && !!(await detailRow(t1)).startedAt);
  const startedAt = String((await detailRow(t1)).startedAt);
  await call("PATCH", `/tasks/${t1}`, M.tok, { status: "PENDING" });
  await call("PATCH", `/tasks/${t1}`, M.tok, { status: "IN_PROGRESS" });
  ok("starting again never moves the original start time", String((await detailRow(t1)).startedAt) === startedAt);
  ok("a work update is saved", (await call("PATCH", `/tasks/${t1}`, M.tok, { workUpdate: "Drafted the roadmap" })).s === 200);
  ok("an empty work update is not saved", (await call("PATCH", `/tasks/${t1}`, M.tok, { workUpdate: "   " })).s === 400);
  const edit = await call("PATCH", `/tasks/${t1}`, M.tok, { description: "Roadmap and budget", weight: "CRITICAL", dueDate: add(today, 3) });
  ok("he can edit description, priority and deadline AFTER approval (his own task)", edit.s === 200 && (await taskRow(t1)).weight === "CRITICAL" && (await detailRow(t1)).dueDate.toISOString().slice(0, 10) === add(today, 3), edit);
  const done = await call("PATCH", `/tasks/${t1}`, M.tok, { status: "COMPLETED" });
  const r1c = await taskRow(t1);
  ok("Mark as completed records the real completion time", done.s === 200 && r1c.status === "COMPLETED" && !!r1c.completedAt, r1c);
  const hist = (await call("GET", `/tasks/${t1}/history`, M.tok)).b.events.map((e) => e.kind);
  ok("the history shows created, started, update, edited and completed, oldest first", ["CREATED", "STARTED", "UPDATE", "EDITED", "COMPLETED"].every((k) => hist.includes(k)) && hist[0] === "CREATED", hist);
  ok("history rows cannot be rewritten (database refuses an update)", await (async () => { try { await q(`update task_events set note='x' where "taskId"=$1`, [t1]); return false; } catch { return true; } })());
  ok("reopening a completed task is allowed and recorded", (await call("PATCH", `/tasks/${t1}`, M.tok, { status: "IN_PROGRESS" })).s === 200 && (await q(`select kind from task_events where "taskId"=$1`, [t1])).some((e) => e.kind === "REOPENED") && (await taskRow(t1)).completedAt === null);
  await call("PATCH", `/tasks/${t1}`, M.tok, { status: "COMPLETED" });
  ok("no notification went to anyone when it was completed", (await q(`select 1 from notifications where type like 'TASK_%' and "createdAt" > now() - interval '2 minutes' and "userId" = $1`, [ADM.id])).length === 0);

  console.log("\n## 5. Deadlines and overdue");
  ok("a deadline in the past is refused", (await call("POST", "/tasks", M.tok, { title: "Late one", dueDate: add(today, -1) })).s === 400);
  ok("a bad date is refused", (await call("POST", "/tasks", M.tok, { title: "Bad date", dueDate: "2026-02-31" })).s === 400);
  const od = await call("POST", "/tasks", M.tok, { title: "Will be overdue", dueDate: today });
  const tOd = idOf(od, "Will be overdue");
  ok("due today is not overdue yet", od.b.tasks.find((t) => t.id === tOd).overdue === false);
  await q(`update task_self_details set "dueDate" = ($2)::date where "taskId"=$1`, [tOd, add(today, -2)]);
  ok("a task whose deadline day has passed and is not completed IS overdue", (await call("GET", "/tasks", M.tok)).b.tasks.find((t) => t.id === tOd).overdue === true);
  const nodl = await call("POST", "/tasks", M.tok, { title: "No deadline" });
  ok("a task with no deadline is never overdue", nodl.b.tasks.find((t) => t.title === "No deadline").overdue === false);

  console.log("\n## 6. Personal productivity (and never the team's)");
  await q(`insert into work_sessions (id,"platformId","userId",date,"loginAt","logoutAt",status,"productiveSeconds","breakSeconds","meetingSeconds","wasLateLogin","lateByMinutes","autoClosed","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3::date, now() - interval '5 hours', null,'ACTIVE',0,0,0,false,0,false,now(),now())`, [AV, M.id, today]).catch(() => null);
  const sum = await call("GET", `/tasks/self/summary?from=${today}&to=${today}`, M.tok);
  ok("the summary counts only his own self-managed tasks", sum.s === 200 && sum.b.ready === true && sum.b.totals.total === 3 && sum.b.totals.completed === 1 && sum.b.totals.overdue === 1, sum.b.totals);
  ok("not started / in progress / completed / overdue add up to the total", sum.b.totals.notStarted + sum.b.totals.inProgress + sum.b.totals.completed === sum.b.totals.total, sum.b.totals);
  ok("daily completion shows today's completed task", sum.b.daily.find((d) => d.date === today)?.completed === 1, sum.b.daily);
  ok("time spent is only reported for a task with a recorded start AND finish (and is never negative)", sum.b.timeSpent.seconds >= 0 && sum.b.timeSpent.timedTasks + sum.b.timeSpent.untimedTasks === sum.b.totals.completed, sum.b.timeSpent);
  ok("an employee cannot read the manager summary -> 403", (await call("GET", `/tasks/self/summary?from=${today}&to=${today}`, E.tok)).s === 403);
  ok("HR cannot either -> 403", (await call("GET", `/tasks/self/summary?from=${today}&to=${today}`, H.tok)).s === 403);
  ok("a bad range -> 400", (await call("GET", `/tasks/self/summary?from=${today}&to=${add(today, -3)}`, M.tok)).s === 400 && (await call("GET", `/tasks/self/summary?from=${add(today, -200)}&to=${today}`, M.tok)).s === 400);

  const prod = await call("GET", `/team-attendance/productivity?from=${today}&to=${today}`, M.tok);
  const mine = (prod.b.people ?? []).find((p) => p.userId === M.id);
  ok("his own completed task does NOT count in the TEAM productivity report", prod.s === 200 && (mine ? JSON.stringify(mine).indexOf('"tasksCompleted":1') === -1 && (mine.tasksCompleted ?? mine.completed ?? 0) === 0 : true), mine);
  const rep = await call("GET", `/reports?from=${today}&to=${today}&groupBy=person`, M.tok);
  const repMe = rep.b.people.find((p) => p.userId === M.id);
  ok("it DOES count in his own Reports row (his personal productivity)", repMe && repMe.tasksCompleted >= 1, repMe);
  ok("and the team totals leave the manager out", rep.b.totals.managersExcluded >= 1);

  console.log("\n## 7. Removing a task");
  console.log("## 6b. Nobody can assign work to a manager (checked on the server)");
  const M2 = await mk("SLF-M2", "MANAGER", ADM.id);
  const tryAssign = async (who, label) => {
    const r = await call("POST", "/tasks/review/assign", who.tok, { userId: M.id, title: "Do this", weight: "LOW" });
    ok(label + " cannot assign to a manager (403)", r.s === 403, r);
  };
  await tryAssign(ADM, "Admin");
  await tryAssign(H, "HR");
  await tryAssign(M2, "another manager");
  await tryAssign(M, "the manager himself (he uses Add task instead)");
  await tryAssign(E, "an employee");
  ok("nothing was created for the manager by those attempts", (await q('select 1 from daily_tasks where "userId"=$1 and title=$2', [M.id, "Do this"])).length === 0);
  const toEmp = await call("POST", "/tasks/review/assign", M.tok, { userId: E.id, title: "For the employee", weight: "LOW" });
  ok("a manager can still assign to his own reporting employee", toEmp.s === 200, toEmp);

  const rm = await call("POST", "/tasks", M.tok, { title: "Remove me" });
  ok("a not-started self-managed task can be removed", (await call("DELETE", `/tasks/${idOf(rm, "Remove me")}`, M.tok)).s === 200);
  ok("a started one cannot be removed", (await call("DELETE", `/tasks/${t1}`, M.tok)).s === 400);

  await wipe();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
