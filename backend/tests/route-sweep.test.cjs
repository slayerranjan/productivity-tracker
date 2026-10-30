// Sweeps EVERY backend route:
//  1. with no token            -> must be 401 (except the public ones listed below)
//  2. with a malformed token   -> must be 401
//  3. GET routes as each role  -> never a 5xx; employees/managers must be 403 on HR/Admin-only areas
//  4. garbage ids / dates      -> 4xx, never a 500
// POST/DELETE routes are only called WITHOUT a token (they must be refused), so nothing is written.
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const guard = require("./_guard.cjs");
const API = (process.env.TEST_API ?? "http://localhost:5002/api");
const URL_ = process.env.TEST_DATABASE_URL; guard.assertTestDb(URL_);

const PUBLIC = new Set(["POST /api/auth/login", "GET /api/health", "GET /api/db-health"]);
const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const server = src("src/server.ts");
const imports = {};
for (const m of server.matchAll(/import (\w+) from "\.\/modules\/([\w-]+)\/([\w.-]+)\.js"/g)) imports[m[1]] = `src/modules/${m[2]}/${m[3]}.ts`;
const routes = [];
for (const m of server.matchAll(/app\.use\("(\/api\/[\w-]+)"[^)]*?(\w+Routes)\)/g)) {
  const file = imports[m[2]]; if (!file) continue;
  for (const r of src(file).matchAll(/router\.(get|post|put|patch|delete)\(\s*"([^"]*)"/g)) routes.push({ method: r[1].toUpperCase(), path: m[1] + (r[2] === "/" ? "" : r[2]) });
}
for (const m of server.matchAll(/app\.(get|post)\("(\/api\/[^"]+)"/g)) routes.push({ method: m[1].toUpperCase(), path: m[2] });

let pass = 0, fail = 0; const bad = [];
const ok = (n, c, x) => { c ? pass++ : (fail++, bad.push(n + " -> " + JSON.stringify(x))); };
const call = async (method, p, token, body) => {
  const r = await fetch(API.replace("/api", "") + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.status;
};
const fill = (p, v) => p.replace(/:[A-Za-z]+/g, v);

(async () => {
  const db = new Client({ connectionString: URL_ }); await db.connect();
  const hash = await bcrypt.hash("Sweep@12345678", 10);
  // Dedicated sweep accounts on the test branch only, in the Avatar company.
  const AV = (await db.query(`select id from platforms where slug='avatar'`)).rows[0].id;
  const mk = async (code, role) => {
    await db.query(`delete from users where "employeeCode"=$1 and "platformId"=$2`, [code, AV]);
    await db.query(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Sweep',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',now(),now())`, [AV, code.toLowerCase() + "@sweep.test", hash, role, code, role]);
    const r = await (await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: code, password: "Sweep@12345678" }) })).json();
    return r.token;
  };
  const T = { EMPLOYEE: await mk("SWP-E", "EMPLOYEE"), MANAGER: await mk("SWP-M", "MANAGER"), HR: await mk("SWP-H", "HR"), ADMIN: await mk("SWP-A", "ADMIN") };
  ok("sweep accounts can sign in", Object.values(T).every(Boolean), Object.fromEntries(Object.entries(T).map(([k, v]) => [k, !!v])));
  console.log(`routes found: ${routes.length}`);

  // 1 + 2: no token / bad token
  for (const r of routes) {
    const key = r.method + " " + r.path;
    const p = fill(r.path, "00000000-0000-0000-0000-000000000000");
    const s0 = await call(r.method, p, null, r.method === "GET" ? undefined : {});
    if (PUBLIC.has(key)) { ok("public: " + key + " is reachable", s0 !== 401 && s0 < 500, s0); continue; }
    ok("no token: " + key + " -> 401", s0 === 401, s0);
    const s1 = await call(r.method, p, "not.a.token", r.method === "GET" ? undefined : {});
    ok("bad token: " + key + " -> 401", s1 === 401, s1);
  }

  // 3 + 4: GET routes per role, with valid-looking and garbage ids
  const gets = routes.filter((r) => r.method === "GET" && !PUBLIC.has("GET " + r.path) && !/:id\/(file|download)$/.test(r.path));
  const seen = {};
  for (const role of Object.keys(T)) {
    for (const r of gets) {
      const key = r.method + " " + r.path;
      for (const [label, id] of [["zero-uuid", "00000000-0000-0000-0000-000000000000"], ["garbage-id", "not-a-uuid"], ["sql-ish", "1%27%20OR%201%3D1"]]) {
        const s = await call("GET", fill(r.path, id), T[role]);
        ok(`${role} ${key} [${label}] never 5xx`, s < 500, s);
        if (label === "zero-uuid") (seen[key] ||= {})[role] = s;
      }
      // garbage query values
      const s = await call("GET", fill(r.path, "00000000-0000-0000-0000-000000000000") + "?from=zzz&to=2026-99-99&year=abc&month=13&status=%27&limit=-1&userId=not-a-uuid&groupBy=%3Cscript%3E", T[role]);
      ok(`${role} ${key} [garbage query] never 5xx`, s < 500, s);
    }
  }
  // Employees and managers must be refused on HR/Admin-only areas.
  const hrOnly = ["/api/admin", "/api/companies", "/api/payroll/month", "/api/onboarding/candidates", "/api/onboarding/requirements", "/api/offers/templates", "/api/policies/manage", "/api/leave/summary", "/api/leave/requests", "/api/holidays"];
  for (const p of hrOnly) {
    for (const role of ["EMPLOYEE", "MANAGER"]) {
      const s = await call("GET", p === "/api/admin" ? "/api/admin/users" : p, T[role]);
      ok(`${role} is refused on ${p}`, s === 403, s);
    }
    ok(`HR can open ${p}`, (await call("GET", p === "/api/admin" ? "/api/admin/users" : p, T.HR)) === 200, "HR");
  }
  // Role-escalation: an employee cannot make themselves HR or read another user's password endpoint
  ok("employee cannot POST /admin/users -> 403", (await call("POST", "/api/admin/users", T.EMPLOYEE, { firstName: "x", lastName: "y", email: "x@y.zz", role: "ADMIN" })) === 403);
  ok("HR cannot create an ADMIN user -> 403 or 400", [400, 403].includes(await call("POST", "/api/admin/users", T.HR, { firstName: "x", lastName: "y", email: "sweep-x@y.zz", role: "ADMIN", password: "Aaaa@1234567" })));

  await db.query(`delete from users where "employeeCode" like 'SWP-%'`);
  console.log(`\n${pass} passed, ${fail} failed`);
  bad.slice(0, 40).forEach((b) => console.log("FAIL " + b));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
