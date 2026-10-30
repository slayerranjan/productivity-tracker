// End-to-end real-time test: a manager session and an employee session, real REST calls, real sockets.
// It CREATES and CHANGES tasks, so it must only run against a disposable Neon branch (_guard.cjs refuses the
// database in backend/.env). Start the backend on the branch (see README) and run:
//
//   cd backend
//   $env:TEST_DATABASE_URL = "<branch url>"; $env:TEST_PW_MANAGER = "..."; $env:TEST_PW_EMPLOYEE = "..."
//   node tests/realtime-e2e.test.mjs
//
// Uses the seeded users manager@avatarindia.com (a MANAGER) and priya@avatarindia.com (an EMPLOYEE who reports to
// them), who must be ACTIVE on the branch.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { assertTestDb } = require("./_guard.cjs");
const { io } = createRequire(new URL("../../frontend/package.json", import.meta.url))("socket.io-client");

assertTestDb(process.env.TEST_DATABASE_URL);
const API = process.env.TEST_API ?? (process.env.TEST_API ?? "http://localhost:5002/api");
const ORIGIN = API.replace(/\/api$/, "");

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + JSON.stringify(x)?.slice(0, 220))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { s: r.status, b: j };
};
const login = async (email, password) => (await call("POST", "/auth/login", null, { email, password })).b;

// The same single-bucket rule the Team tasks page uses (bucketOf in approvals/page.tsx).
const bucketOf = (t) => { const a = String(t.approvalStatus), s = String(t.status); if (a === "PENDING") return "waiting"; if (a === "REJECTED" || s === "CANCELLED") return "closed"; if (s === "IN_PROGRESS") return "inProgress"; if (s === "COMPLETED") return "completed"; return "todo"; };
const counts = (rows) => { const c = { waiting: 0, todo: 0, inProgress: 0, completed: 0, closed: 0 }; for (const t of rows) c[bucketOf(t)]++; return c; };

function listen(token) {
  const events = [];
  const sock = io(ORIGIN, { auth: { token }, transports: ["websocket"], reconnectionDelay: 200 });
  sock.on("tasks:changed", (e) => events.push(e));
  return new Promise((resolve) => { sock.on("ready", () => resolve({ sock, events })); sock.on("connect_error", (e) => resolve({ sock, events, error: e.message })); });
}
const waitFor = async (events, pred, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const e = events.find(pred); if (e) return e; await sleep(50); } return null; };

const M = await login("manager@avatarindia.com", process.env.TEST_PW_MANAGER);
const E = await login("priya@avatarindia.com", process.env.TEST_PW_EMPLOYEE);
ok("both sessions signed in", !!M.token && !!E.token, [M.error, E.error]);
const me = E.user.id;
const mgr = await listen(M.token), emp = await listen(E.token);
ok("both sockets connected", !mgr.error && !emp.error, [mgr.error, emp.error]);
const queue = async () => (await call("GET", "/tasks/review/queue", M.token)).b;
const mine = (q) => q.all.filter((t) => t.userId === me);
const base = counts(mine(await queue()));
const stamp = "rt-e2e-" + Date.now();

// 1-2. manager assigns a task -> the employee hears it, the manager's queue changes
let t0 = Date.now();
const assigned = await call("POST", "/tasks/review/assign", M.token, { userId: me, title: stamp + " assigned", weight: "MEDIUM" });
ok("manager assigns a task", assigned.s === 200, assigned);
const eAssigned = await waitFor(emp.events, (e) => e.action === "assigned");
ok(`employee is told immediately (${Date.now() - t0} ms)`, !!eAssigned);
const task = (await queue()).all.find((t) => t.title === stamp + " assigned");
ok("the task is real, and in the To do tab for that employee", !!task && bucketOf(task) === "todo", task);
ok("employee's To do count rose by exactly 1", counts(mine(await queue())).todo === base.todo + 1);

// 3-4. employee starts it -> the manager hears it
t0 = Date.now();
const started = await call("PATCH", "/tasks/" + task.id, E.token, { status: "IN_PROGRESS" });
ok("employee starts the task", started.s === 200, started);
const mStatus = await waitFor(mgr.events, (e) => e.taskId === task.id && e.action === "status");
ok(`manager is told immediately (${Date.now() - t0} ms)`, !!mStatus);
let c = counts(mine(await queue()));
ok("To do -1, In progress +1 for that employee", c.todo === base.todo && c.inProgress === base.inProgress + 1, { base, c });

// 5-6. employee proposes a task that needs approval -> the manager sees it in Needs approval
t0 = Date.now();
const proposed = await call("POST", "/tasks", E.token, { title: stamp + " proposed", weight: "LOW" });
ok("employee proposes a task", proposed.s === 200, proposed);
const mCreated = await waitFor(mgr.events, (e) => e.action === "created");
ok(`manager is told immediately (${Date.now() - t0} ms)`, !!mCreated);
const prop = (await queue()).all.find((t) => t.title === stamp + " proposed");
ok("it sits in Needs approval (or was auto-approved if the employee has no manager)", !!prop && ["waiting", "todo"].includes(bucketOf(prop)), prop && bucketOf(prop));

// 7-9. manager approves -> employee hears it; employee completes -> manager hears it
if (prop && bucketOf(prop) === "waiting") {
  t0 = Date.now();
  const approved = await call("POST", `/tasks/review/${prop.id}/approve`, M.token, { approve: true });
  ok("manager approves", approved.s === 200, approved);
  ok(`employee is told immediately (${Date.now() - t0} ms)`, !!(await waitFor(emp.events, (e) => e.taskId === prop.id && e.action === "approved")));
}
const done = await call("PATCH", "/tasks/" + task.id, E.token, { status: "COMPLETED" });
ok("employee completes the task", done.s === 200, done);
ok("manager is told", !!(await waitFor(mgr.events, (e) => e.taskId === task.id && e.action === "status" && e !== mStatus)));
c = counts(mine(await queue()));
ok("the task moved to Completed for that employee", bucketOf((await queue()).all.find((t) => t.id === task.id)) === "completed" && c.completed === base.completed + 1, { base, c });
const graded = await call("POST", `/tasks/review/${task.id}/outcome`, M.token, { outcome: "COMPLETED" });
ok("manager grades it", graded.s === 200, graded);
ok("employee is told about the grade", !!(await waitFor(emp.events, (e) => e.taskId === task.id && e.action === "graded")));

// 10. counters reconcile for the employee and for everyone, from the database
const q = await queue();
const total = counts(q.all);
ok("for everyone: the five tabs add up to the tasks in view", Object.values(total).reduce((a, b) => a + b, 0) === q.all.length, total);
ok("for the employee: the five tabs add up to their tasks", Object.values(counts(mine(q))).reduce((a, b) => a + b, 0) === mine(q).length);
ok("no task appears twice", new Set(q.all.map((t) => t.id)).size === q.all.length);

// reconnect: drop the manager's network, change something, reconnect, and the signal for a LATER change still arrives
mgr.sock.io.engine.close();
await sleep(1200);
ok("the manager's socket reconnects by itself", mgr.sock.connected);
mgr.events.length = 0;
await call("PATCH", "/tasks/" + prop?.id, E.token, { status: "IN_PROGRESS" });
ok("events flow again after the reconnect", !!(await waitFor(mgr.events, () => true)));

// the employee must not be able to read the manager's queue, and a socket without a token is refused
ok("an employee cannot open the manager queue", (await call("GET", "/tasks/review/queue", E.token)).s === 403);
const anon = await listen("");
ok("a socket with no token is refused", anon.error === "NOT_AUTHENTICATED", anon.error);

// tidy up what this test created (assigned tasks cannot be deleted by the employee; the branch is disposable)
mgr.sock.close(); emp.sock.close(); anon.sock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
