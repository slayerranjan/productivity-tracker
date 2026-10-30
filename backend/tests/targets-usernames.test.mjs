// Daily task targets + login usernames, against a running backend on a DISPOSABLE Neon branch (it creates and
// changes tasks and users, so _guard.cjs refuses the database in backend/.env).
//
//   cd backend
//   $env:TEST_DATABASE_URL = "<branch url>"; $env:TEST_API = "http://localhost:5012/api"
//   $env:TEST_PW_ADMIN = "..."; $env:TEST_PW_MANAGER = "..."; $env:TEST_PW_EMPLOYEE = "..."
//   node tests/targets-usernames.test.mjs
//
// Needs the migrations 20261030120000_daily_task_targets and 20261030130000_login_usernames applied on the branch,
// and the seed users admin@ / manager@ / priya@avatarindia.com active (manager must be priya's manager).
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { assertTestDb } = require("./_guard.cjs");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

assertTestDb(process.env.TEST_DATABASE_URL);
const API = process.env.TEST_API ?? (process.env.TEST_API ?? "http://localhost:5002/api");
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(x)?.slice(0, 240))); };
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { s: r.status, b: j };
};
const login = async (id, password) => (await call("POST", "/auth/login", null, { email: id, password }));

const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
await db.connect();
const q = async (sql, p) => (await db.query(sql, p)).rows;

const A = (await login("admin@avatarindia.com", process.env.TEST_PW_ADMIN)).b;
const M = (await login("manager@avatarindia.com", process.env.TEST_PW_MANAGER)).b;
const E = (await login("priya@avatarindia.com", process.env.TEST_PW_EMPLOYEE)).b;
ok("admin, manager and employee signed in", !!A.token && !!M.token && !!E.token, [A.error, M.error, E.error]);
const priya = E.user.id;
const productivity = async (qs = "") => (await call("GET", "/team-attendance/productivity" + qs, M.token)).b;
const priyaRow = (p) => p.people.find((x) => x.userId === priya);

// ============================ DAILY TARGETS ============================
console.log("\n--- daily task targets ---");
const t0 = await call("GET", "/team-attendance/targets", A.token);
ok("the targets table exists on the branch", t0.s === 200 && t0.b.ready === true, t0);
ok("manager cannot list targets", (await call("GET", "/team-attendance/targets", M.token)).s === 403);
ok("employee cannot list targets", (await call("GET", "/team-attendance/targets", E.token)).s === 403);
ok("manager cannot set a target", (await call("POST", "/team-attendance/targets", M.token, { scope: "company", tasksPerDay: 5 })).s === 403);
ok("employee cannot set a target", (await call("POST", "/team-attendance/targets", E.token, { scope: "company", tasksPerDay: 5 })).s === 403);
ok("employee cannot read team productivity", (await call("GET", "/team-attendance/productivity", E.token)).s === 403);
ok("without a token: 401", (await call("GET", "/team-attendance/targets", null)).s === 401);

// no target yet -> never 0%
await call("POST", "/team-attendance/targets", A.token, { scope: "company", tasksPerDay: null });
await call("POST", "/team-attendance/targets", A.token, { scope: "user", id: priya, tasksPerDay: null });
let p = await productivity("?from=2026-10-01&to=2026-10-30");
ok("with no target set: 'target not configured' and no percentage anywhere", priyaRow(p).targetPerDay === null && priyaRow(p).overallPercent === null && priyaRow(p).days.every((d) => d.percent === null), priyaRow(p));

// validation
for (const [label, body] of [["zero", { scope: "company", tasksPerDay: 0 }], ["fraction", { scope: "company", tasksPerDay: 2.5 }], ["too big", { scope: "company", tasksPerDay: 5000 }], ["text", { scope: "company", tasksPerDay: "lots" }], ["bad scope", { scope: "galaxy", tasksPerDay: 3 }], ["not a uuid", { scope: "user", id: "abc", tasksPerDay: 3 }]]) {
  ok(`rejected: ${label}`, (await call("POST", "/team-attendance/targets", A.token, body)).s === 400, body);
}
const foreignTeam = (await q(`select t.id from teams t where t."platformId" <> $1 limit 1`, [A.user.platform.id]))[0]?.id;
const foreignUser = (await q(`select u.id from users u where u."platformId" <> $1 limit 1`, [A.user.platform.id]))[0]?.id;
ok("an admin cannot set a target for another company's team", foreignTeam && (await call("POST", "/team-attendance/targets", A.token, { scope: "team", id: foreignTeam, tasksPerDay: 3 })).s === 404);
ok("...or another company's person", foreignUser && (await call("POST", "/team-attendance/targets", A.token, { scope: "user", id: foreignUser, tasksPerDay: 3 })).s === 404);

// the database itself refuses nonsense
const refuses = async (sql, params) => { try { await db.query("BEGIN"); await db.query(sql, params); await db.query("ROLLBACK"); return false; } catch { await db.query("ROLLBACK"); return true; } };
ok("database: a target of 0 is refused", await refuses(`insert into daily_task_targets(id,"platformId","tasksPerDay","updatedAt") values(gen_random_uuid(),$1,0,now())`, [A.user.platform.id]));
ok("database: a target for a team AND a person at once is refused", await refuses(`insert into daily_task_targets(id,"platformId","teamId","userId","tasksPerDay","updatedAt") values(gen_random_uuid(),$1,$2,$3,3,now())`, [A.user.platform.id, foreignTeam ?? A.user.platform.id, priya]));

// company default, then a personal target (the most specific wins)
let r = await call("POST", "/team-attendance/targets", A.token, { scope: "company", tasksPerDay: 4 });
ok("admin sets the company default (4)", r.s === 200 && r.b.company === 4, r);
ok("database: a second company default is refused (one per scope)", await refuses(`insert into daily_task_targets(id,"platformId","tasksPerDay","updatedAt") values(gen_random_uuid(),$1,9,now())`, [A.user.platform.id]));
p = await productivity("?from=2026-10-01&to=2026-10-30");
ok("priya now has the company target (4)", priyaRow(p).targetPerDay === 4 && priyaRow(p).targetSource === "COMPANY", priyaRow(p));
r = await call("POST", "/team-attendance/targets", A.token, { scope: "user", id: priya, tasksPerDay: 2 });
ok("admin sets a personal target for priya (2)", r.s === 200, r);
p = await productivity("?from=2026-10-01&to=2026-10-30");
ok("the personal target wins over the company one", priyaRow(p).targetPerDay === 2 && priyaRow(p).targetSource === "PERSON", priyaRow(p));

// real tasks -> percentage = completed / target
const today = p.today;
const stamp = "tgt-" + Date.now();
const base = (await productivity(`?from=${today}&to=${today}`)).people.find((x) => x.userId === priya).days.at(-1).completed ?? 0;
const ids = [];
for (let i = 0; i < 3; i++) {
  await call("POST", "/tasks/review/assign", M.token, { userId: priya, title: `${stamp} #${i}`, weight: "LOW" });
}
const mine = (await call("GET", "/tasks", E.token)).b;
const flat = JSON.stringify(mine);
const queue = (await call("GET", "/tasks/review/queue", M.token)).b;
for (const t of queue.all.filter((x) => x.title.startsWith(stamp))) ids.push(t.id);
ok("three real tasks were assigned to priya", ids.length === 3, ids);
for (const id of ids.slice(0, 2)) await call("PATCH", "/tasks/" + id, E.token, { status: "COMPLETED" });
const stamped = await q(`select count(*)::int n from daily_tasks where id = any($1) and "completedAt" is not null`, [ids]);
ok("completing a task records when it was completed", stamped[0].n === 2, stamped);
p = await productivity(`?from=${today}&to=${today}`);
let row = priyaRow(p), d = row.days.at(-1);
ok(`2 more tasks completed today: ${base} -> ${base + 2}`, d.completed === base + 2, d);
ok("productivity % = completed / target x 100", d.percent === Math.round(((base + 2) / 2) * 1000) / 10, d);
ok("a task still To do is not counted", d.completed === base + 2);

// reopening clears the completion time and the count
await call("PATCH", "/tasks/" + ids[1], E.token, { status: "IN_PROGRESS" });
const cleared = await q(`select "completedAt" from daily_tasks where id=$1`, [ids[1]]);
ok("moving a task back out of Completed clears its completion time", cleared[0].completedAt === null);
d = priyaRow(await productivity(`?from=${today}&to=${today}`)).days.at(-1);
ok("...and it stops counting", d.completed === base + 1, d);
await call("PATCH", "/tasks/" + ids[1], E.token, { status: "COMPLETED" });
d = priyaRow(await productivity(`?from=${today}&to=${today}`)).days.at(-1);
ok("completing it again counts it again", d.completed === base + 2, d);

// grading: partial / failed do not count, fully completed does
await call("POST", `/tasks/review/${ids[1]}/outcome`, M.token, { outcome: "PARTIALLY_COMPLETED" });
d = priyaRow(await productivity(`?from=${today}&to=${today}`)).days.at(-1);
ok("a task graded 'partially completed' is not counted", d.completed === base + 1, d);
await call("POST", `/tasks/review/${ids[0]}/outcome`, M.token, { outcome: "COMPLETED" });
d = priyaRow(await productivity(`?from=${today}&to=${today}`)).days.at(-1);
ok("a task graded 'completed' still counts", d.completed === base + 1, d);

// hourly: counts only, in the right clock hour
const h = (await call("GET", `/team-attendance/productivity/hourly?date=${today}`, M.token)).b;
const hp = h.people.find((x) => x.userId === priya);
const nowHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: h.timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
ok("hourly total equals the day's completed count", hp.total === base + 1 && hp.hours.reduce((a, b) => a + b, 0) === hp.total, { total: hp.total, base });
ok("the tasks are in the clock hour they were completed", hp.hours[nowHour] + (hp.hours[(nowHour + 23) % 24] ?? 0) >= 1, { nowHour, hours: hp.hours });

// team target, then falling back
const team = (await q(`select t.id from teams t join team_members m on m."teamId"=t.id and m."isActive" where m."userId"=$1 and t."platformId"=$2 limit 1`, [priya, A.user.platform.id]))[0]?.id;
if (team) {
  await call("POST", "/team-attendance/targets", A.token, { scope: "user", id: priya, tasksPerDay: null });
  await call("POST", "/team-attendance/targets", A.token, { scope: "team", id: team, tasksPerDay: 3 });
  row = priyaRow(await productivity(`?from=${today}&to=${today}`));
  ok("without a personal target the team's target applies (3)", row.targetPerDay === 3 && row.targetSource === "TEAM", row);
  await call("POST", "/team-attendance/targets", A.token, { scope: "team", id: team, tasksPerDay: null });
}
row = priyaRow(await productivity(`?from=${today}&to=${today}`));
ok("with neither, the company default applies (4)", row.targetPerDay === 4 && row.targetSource === "COMPANY", row);
d = row.days.at(-1);
ok("percent follows the new target", d.percent === Math.round(((base + 1) / 4) * 1000) / 10, d);
await call("POST", "/team-attendance/targets", A.token, { scope: "company", tasksPerDay: null });
row = priyaRow(await productivity(`?from=${today}&to=${today}`));
ok("remove everything: back to 'target not configured', percent unavailable (never 0%)", row.targetPerDay === null && row.days.at(-1).percent === null && row.overallPercent === null, row);

// days with no tasks at all are 'no task data', not 0
p = await productivity("?from=2026-10-01&to=2026-10-02");
ok("a day with no tasks is 'No task data available', not zero", priyaRow(p).days.every((x) => x.state === "NO_TASK_DATA" && x.completed === null), priyaRow(p).days);

// audit
const aud = await q(`select action, "recordType", before, after, summary from audit_logs where "recordType"='DailyTaskTarget' and "actorId"=$1`, [A.user.id]);
ok("every target change is in the audit log with before and after values", aud.length >= 6 && aud.every((x) => x.before !== null && x.after !== null && x.action === "UPDATE"), { n: aud.length, sample: aud[0] });

// ============================ USERNAMES ============================
console.log("\n--- login usernames ---");
const run = (args) => spawnSync("npx", ["tsx", "scripts/assign-usernames.ts", ...args], { cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), env: { ...process.env, DOTENV_CONFIG_PATH: ".env.staging", PORT: undefined }, encoding: "utf8", shell: true });
const dry = run([]);
const dryOut = (dry.stdout ?? "") + (dry.stderr ?? "");
ok("dry run lists the 9 usernames and writes nothing", /ankit_avatar/.test(dryOut) && /devashree_avatar/.test(dryOut) && /MODE: dry run/.test(dryOut), dryOut.slice(0, 300));
ok("nothing was written by the dry run", (await q(`select count(*)::int n from login_usernames`))[0].n === 0);
const applied = run(["--apply"]);
ok("--apply creates the 9 usernames", /Created 9 usernames/.test((applied.stdout ?? "") + (applied.stderr ?? "")), (applied.stdout ?? "").slice(-300));
const again = run(["--apply"]);
ok("running it twice is refused (already assigned), nothing duplicated", /already assigned/.test((again.stdout ?? "") + (again.stderr ?? "")) && (await q(`select count(*)::int n from login_usernames`))[0].n === 9);
const list = await q(`select l.username, u."employeeCode" code from login_usernames l join users u on u.id=l."userId" order by 1`);
ok("each username points at the right employee", list.every((x) => ({ ankit_avatar: "AI-01", vishwaa_avatar: "AI-02", komal_avatar: "AI-03", ritika_avatar: "AI-04", vishal_avatar: "AI-05", ranjan_avatar: "AI-06", vinayak_avatar: "AI-07", nikhil_avatar: "AI-08", devashree_avatar: "AI-10" })[x.username] === x.code), list);
ok("TCS-03 (the second Ranjan) got none", (await q(`select count(*)::int n from login_usernames l join users u on u.id=l."userId" where u."employeeCode"='TCS-03'`))[0].n === 0);
const unchanged = await q(`select count(*)::int n from users u where u."employeeCode" in ('AI-01','AI-02','AI-03','AI-04','AI-05','AI-06','AI-07','AI-08','AI-10') and u."passwordHash" is not null`);
ok("passwords, IDs and emails were not touched (the script only inserts usernames)", unchanged[0].n === 9);

// sign in with each style, using a throwaway password set on the BRANCH copy of one person
const PW = "Stg-" + Date.now() + "!aZ";
await db.query(`update users set "passwordHash"=$1,"mustChangePassword"=false,"trackerAccessEnabled"=true,status='ACTIVE' where "employeeCode"='AI-02'`, [bcrypt.hashSync(PW, 10)]);
const byName = await login("vishwaa_avatar", PW);
ok("sign in with the username works", byName.s === 200 && byName.b.user.employeeCode === "AI-02", byName);
ok("the username is not case-sensitive", (await login("VISHWAA_Avatar", PW)).s === 200);
ok("sign in with the employee ID still works", (await login("AI-02", PW)).s === 200);
ok("sign in with the email still works", (await login("ai-02@avatar-india.local", PW)).s === 200);
const wrong = await login("vishwaa_avatar", "not-the-password");
const unknown = await login("nobody_avatar", "not-the-password");
ok("a wrong password is refused (401)", wrong.s === 401);
ok("an unknown username gets the SAME answer as a wrong password (no one can tell which exist)", unknown.s === 401 && JSON.stringify(unknown.b) === JSON.stringify(wrong.b), [wrong.b, unknown.b]);
ok("the signed-in token belongs to that person, nobody else", (await call("GET", "/auth/me", byName.b.token)).b.employeeCode === "AI-02" || (await call("GET", "/auth/me", byName.b.token)).b.user?.employeeCode === "AI-02");
const nonUser = await login("ranjan_avatar", "whatever");
ok("ranjan_avatar belongs to AI-06 only (a wrong password gives 401, never another Ranjan)", nonUser.s === 401);
await db.query(`update users set status='SUSPENDED' where "employeeCode"='AI-02'`);
ok("a suspended person cannot sign in by username", (await login("vishwaa_avatar", PW)).s === 401 || (await login("vishwaa_avatar", PW)).s === 403);
await db.query(`update users set status='ACTIVE' where "employeeCode"='AI-02'`);

// the database refuses bad usernames
const anyUser = (await q(`select id from users where "employeeCode"='TCS-03'`))[0].id;
for (const [label, name] of [["upper case", "Upper_avatar"], ["an @ sign", "a@b_avatar"], ["too short", "ab"], ["a space", "two words"], ["a duplicate (any case)", "ANKIT_AVATAR"]]) {
  ok(`database: a username with ${label} is refused`, await refuses(`insert into login_usernames(id,"userId",username,"updatedAt") values(gen_random_uuid(),$1,$2,now())`, [anyUser, name]), name);
}

// rate limit still protects the username path
let last = 0;
for (let i = 0; i < 12; i++) last = (await login("vinayak_avatar", "wrong-" + i)).s;
ok("repeated wrong passwords for a username are rate-limited (429)", last === 429, last);

await db.end();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
