// Sends garbage values in the body of EVERY write route (POST/PATCH/DELETE) as Admin, HR, Manager and
// Employee. A well-behaved API answers with a 4xx; a 5xx means an unhandled error.
// Runs on a disposable branch only (it really does write, e.g. clock-in).
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const fs = require("fs"), path = require("path");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");
const API = "http://localhost:5002";
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);

const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const server = src("src/server.ts");
const imports = {};
for (const m of server.matchAll(/import (\w+) from "\.\/modules\/([\w-]+)\/([\w.-]+)\.js"/g)) imports[m[1]] = `src/modules/${m[2]}/${m[3]}.ts`;
const routes = [];
for (const m of server.matchAll(/app\.use\("(\/api\/[\w-]+)"[^)]*?(\w+Routes)\)/g)) {
  const file = imports[m[2]]; if (!file) continue;
  for (const r of src(file).matchAll(/router\.(post|patch|put|delete)\(\s*"([^"]*)"/g)) routes.push({ method: r[1].toUpperCase(), path: m[1] + (r[2] === "/" ? "" : r[2]) });
}
const SKIP = new Set(["POST /api/auth/login"]);
const ONLY = process.env.ONLY_PATH; // optional: only routes containing this text
const garbage = (v) => ({
  id: v, userId: v, userIds: [v], teamId: v, managerId: v, reportsToId: v, shiftId: v, candidateId: v, templateId: v,
  requirementId: v, platformId: v, projectId: v, taskId: v, slipIds: [v], from: v, to: v, date: v, month: v, year: v,
  status: v, role: v, category: v, priority: v, weight: v, grade: v, leaveType: v, decision: v, approve: v, accept: v,
  email: v, name: v, title: v, subject: v, description: v, reason: v, password: v, newPassword: v, currentPassword: v,
  fileName: v, data: v, mimeType: v, dateOfJoining: v, correctionDate: v, requestedLoginAt: v, requestedLogoutAt: v,
  breakType: v, meetingType: v, teamType: v, timezone: v, employeeCodePrefix: v, startTime: v, endTime: v, workingDays: v,
  dailyWorkHours: v, productiveHours: v, breakBudgetMinutes: v, isActive: v, publish: v, rows: v, mapping: v, confirm: v,
});
let pass = 0, fail = 0; const bad = [];
const call = async (m, p, t, body) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", authorization: "Bearer " + t }, body: m === "DELETE" ? undefined : JSON.stringify(body) });
  return r.status;
};
(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const AV = (await db.query(`select id from platforms where slug='avatar'`)).rows[0].id;
  const hash = await bcrypt.hash("Fuzz@12345678", 10);
  await db.query(`delete from users where "employeeCode" like 'FZZ-%' and "platformId"=$1`, [AV]);
  const T = {};
  for (const [code, role] of [["FZZ-E", "EMPLOYEE"], ["FZZ-M", "MANAGER"], ["FZZ-H", "HR"], ["FZZ-A", "ADMIN"]]) {
    await db.query(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Fuzz',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',now(),now())`, [AV, code.toLowerCase() + "@fuzz.test", hash, role, code, role]);
    T[role] = (await (await fetch(API + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: code, password: "Fuzz@12345678" }) })).json()).token;
  }
  console.log("write routes:", routes.length);
  const values = ["not-a-uuid", "zzz", "' OR 1=1 --", 1e12, -1, null, [], {}, "<script>alert(1)</script>", "x".repeat(5000)];
  for (const role of Object.keys(T)) {
    for (const r of routes) {
      if (SKIP.has(r.method + " " + r.path)) continue;
      if (ONLY && !r.path.includes(ONLY)) continue;
      for (const v of values) {
        const p = r.path.replace(/:[A-Za-z]+/g, "00000000-0000-0000-0000-000000000000");
        const s = await call(r.method, p, T[role], garbage(v));
        if (s >= 500) { fail++; bad.push(`${role} ${r.method} ${r.path} [${String(JSON.stringify(v)).slice(0, 20)}] -> ${s}`); } else pass++;
      }
    }
  }
  await db.query(`delete from users where "employeeCode" like 'FZZ-%' and "platformId"=$1`, [AV]);
  console.log(`\n${pass} passed, ${fail} failed`);
  const byRoute = {}; for (const b of bad) { const k = b.replace(/ [[^]]*] -> /, " -> "); byRoute[k] = (byRoute[k] || 0) + 1; } Object.entries(byRoute).forEach(([k, n]) => console.log("FAIL x" + n + " " + k));
  await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
