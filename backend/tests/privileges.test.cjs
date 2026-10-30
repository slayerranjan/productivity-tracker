// Role hierarchy: only an ADMIN may create, promote, suspend or reset the password of an HR or Admin account.
// (Regression test for a bug where HR could make themselves Admin.)
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const API = (process.env.TEST_API ?? "http://localhost:5002/api");
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);
const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let j; try { j = await r.json(); } catch { j = null; } return { s: r.status, b: j };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 250))); };
(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const AV = (await db.query(`select id from platforms where slug='avatar'`)).rows[0].id;
  const hash = await bcrypt.hash("Priv@12345678", 10);
  await db.query(`delete from users where "employeeCode" like 'PRV-%' and "platformId"=$1`, [AV]);
  const mk = async (code, role) => {
    await db.query(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Priv',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',now(),now())`, [AV, code.toLowerCase() + "@priv.test", hash, role, code, role]);
    const tok = (await call("POST", "/auth/login", null, { email: code, password: "Priv@12345678" })).b.token;
    const id = (await db.query(`select id from users where "employeeCode"=$1 and "platformId"=$2`, [code, AV])).rows[0].id;
    return { tok, id };
  };
  const hr = await mk("PRV-HR", "HR"), hr2 = await mk("PRV-HR2", "HR"), adm = await mk("PRV-ADM", "ADMIN"), emp = await mk("PRV-EMP", "EMPLOYEE");
  const body = (email, role) => ({ firstName: "Esc", lastName: "Test", email, role, password: "Aaaa@1234567", skipOnboarding: true });
  const roleOf = async (id) => (await db.query(`select role,status from users where id=$1`, [id])).rows[0];

  console.log("\n## HR cannot escalate");
  ok("HR cannot create an ADMIN -> 403", (await call("POST", "/admin/users", hr.tok, body("priv-a@example.com", "ADMIN"))).s === 403);
  ok("HR cannot create another HR -> 403", (await call("POST", "/admin/users", hr.tok, body("priv-h@example.com", "HR"))).s === 403);
  ok("nothing was created", (await db.query(`select count(*)::int n from users where email like 'priv-%@example.com'`)).rows[0].n === 0);
  ok("HR can still create a MANAGER", (await call("POST", "/admin/users", hr.tok, body("priv-m@example.com", "MANAGER"))).s === 201);
  ok("HR can still create an EMPLOYEE", (await call("POST", "/admin/users", hr.tok, body("priv-e@example.com", "EMPLOYEE"))).s === 201);
  ok("HR cannot promote an employee to ADMIN -> 403", (await call("PATCH", `/admin/users/${emp.id}`, hr.tok, { role: "ADMIN" })).s === 403 && (await roleOf(emp.id)).role === "EMPLOYEE");
  ok("HR cannot promote THEMSELVES to ADMIN -> 403", (await call("PATCH", `/admin/users/${hr.id}`, hr.tok, { role: "ADMIN" })).s === 403 && (await roleOf(hr.id)).role === "HR");
  ok("HR cannot suspend an ADMIN -> 403", (await call("PATCH", `/admin/users/${adm.id}`, hr.tok, { status: "SUSPENDED" })).s === 403 && (await roleOf(adm.id)).status === "ACTIVE");
  ok("HR cannot edit another HR -> 403", (await call("PATCH", `/admin/users/${hr2.id}`, hr.tok, { designation: "x" })).s === 403);
  ok("HR cannot reset an ADMIN's password -> 403", (await call("POST", `/admin/users/${adm.id}/password`, hr.tok, { password: "Hacked@12345" })).s === 403);
  ok("...and the Admin's old password still works", !!(await call("POST", "/auth/login", null, { email: "PRV-ADM", password: "Priv@12345678" })).b.token);
  ok("HR cannot suspend themselves (own status) -> 403", (await call("PATCH", `/admin/users/${hr.id}`, hr.tok, { status: "SUSPENDED" })).s === 403);
  ok("HR can edit an ordinary employee", (await call("PATCH", `/admin/users/${emp.id}`, hr.tok, { designation: "Analyst" })).s === 200);
  ok("HR can reset an employee's password", (await call("POST", `/admin/users/${emp.id}/password`, hr.tok, { password: "NewPass@12345" })).s === 200);
  const opt = (await call("GET", "/admin/options", hr.tok)).b;
  ok("HR is only offered EMPLOYEE and MANAGER roles", JSON.stringify(opt.roles) === JSON.stringify(["EMPLOYEE", "MANAGER"]), opt.roles);

  console.log("\n## Admin keeps full power");
  ok("ADMIN can create an HR -> 201", (await call("POST", "/admin/users", adm.tok, body("priv-h2@example.com", "HR"))).s === 201);
  ok("ADMIN can promote an employee to HR", (await call("PATCH", `/admin/users/${emp.id}`, adm.tok, { role: "HR" })).s === 200 && (await roleOf(emp.id)).role === "HR");
  ok("ADMIN can reset an HR's password", (await call("POST", `/admin/users/${hr.id}/password`, adm.tok, { password: "Reset@12345678" })).s === 200);
  ok("ADMIN is offered all four roles", ((await call("GET", "/admin/options", adm.tok)).b.roles ?? []).length === 4);

  await db.query(`delete from users where "employeeCode" like 'PRV-%' and "platformId"=$1`, [AV]);
  await db.query(`delete from users where email like 'priv-%@example.com'`);
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
