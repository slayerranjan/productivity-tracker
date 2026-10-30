const path = "";
const { Client } = require(path + "pg");
const API = "http://localhost:5002/api";
const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j };
};
const login = async (id) => (await call("POST", "/auth/login", null, { email: id, password: "Test@12345678" })).b.token;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
(async () => {
  const BR = process.env.TEST_DATABASE_URL; require("./_guard.cjs").assertTestDb(BR);
  const db = new Client({ connectionString: BR }); await db.connect();
  const AI = (await db.query(`select id from platforms where slug='avatar-india'`)).rows[0].id;
  const inAI = new Set((await db.query(`select id from users where "platformId"=$1`, [AI])).rows.map((r) => r.id));
  const foreign = (await db.query(`select u."employeeCode" c, u.id from users u join users m on m.id=u."reportsToId" where m."platformId"=$1 and u."platformId"<>$1`, [AI])).rows;
  console.log("   cross-company reports of Avatar India managers on this branch:", foreign.length);
  const M = await login("AI-01"), H = await login("AI-02");
  const ids = (x) => JSON.stringify(x);
  const has = (blob) => foreign.some((f) => blob.includes(f.id) || blob.includes(f.c));
  const team = await call("GET", "/tracker/team", M);
  ok("manager live team has no other-company people", team.s === 200 && !has(ids(team.b)), team.s);
  const rep = await call("GET", "/reports?from=2026-10-01&to=2026-10-28&groupBy=person", M);
  ok("manager reports have no other-company people", rep.s === 200 && !has(ids(rep.b)), rep.s);
  const queue = await call("GET", "/tasks/review/queue", M);
  ok("manager task queue has no other-company people", queue.s === 200 && !has(ids(queue.b)), queue.s);
  const alerts = await call("GET", "/tracker/alerts", M);
  ok("manager alerts have no other-company people", alerts.s === 200 && !has(ids(alerts.b)), alerts.s);
  const pr = await call("GET", "/projects", M);
  ok("manager projects: only Avatar India teams, no foreign members/managers", pr.s === 200 && (pr.b.projects ?? []).every((p) => p.companyId === AI) && !has(ids(pr.b)), pr.s);
  const o = (await call("GET", "/admin/options", H)).b;
  const optIds = [...(o.people ?? []), ...(o.managers ?? [])].map((x) => x.id);
  ok("HR dropdowns (managers/people) = Avatar India only", optIds.length > 0 && optIds.every((i) => inAI.has(i)), optIds.length);
  for (const f of foreign.slice(0, 3)) {
    const t = await call("GET", `/reports?from=2026-10-01&to=2026-10-28&groupBy=person&userId=${f.id}`, M);
    ok("manager cannot read a foreign report by id (" + f.c + ")", (t.b.people ?? []).length === 0, t.b);
  }
  const hp = await call("GET", "/projects", H);
  ok("HR projects: only Avatar India, no foreign members/managers", (hp.b.projects ?? []).every((p) => p.companyId === AI) && !has(ids(hp.b)), hp.s);
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
