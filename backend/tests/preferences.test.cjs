// Per-person theme preference: default, saving, isolation between people, validation.
// Disposable Neon branch only (see _guard.cjs). Backend must run on the branch's port with migration
// 20261101130000_user_preferences applied there first.
//
//   cd backend && TEST_DATABASE_URL=... TEST_API=http://localhost:5012/api node tests/preferences.test.cjs
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
const PW = "Pref@12345678";

(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const AV = (await q(`select id from platforms where slug='avatar'`))[0].id;
  const hash = await bcrypt.hash(PW, 10);
  const wipe = async () => { await q(`delete from users where "employeeCode" like 'PRF-%'`); };
  await wipe();
  const mk = async (code, role, mustChange = false) => {
    await q(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Prf',$4,$5,$6,'ACTIVE',$7,true,'ACTIVE',now(),now())`, [AV, code.toLowerCase() + "@prf.test", hash, code.replace("PRF-", "T"), code, role, mustChange]);
    const id = (await q(`select id from users where "employeeCode"=$1`, [code]))[0].id;
    const login = async () => (await call("POST", "/auth/login", null, { email: code, password: PW })).b.token;
    return { id, tok: await login(), login, code };
  };
  const A = await mk("PRF-A", "EMPLOYEE"), B = await mk("PRF-B", "EMPLOYEE"), M = await mk("PRF-M", "MANAGER"), H = await mk("PRF-H", "HR"), AD = await mk("PRF-AD", "ADMIN"), J = await mk("PRF-J", "EMPLOYEE", true);

  console.log("\n## 1. Access");
  ok("not signed in: read -> 401", (await call("GET", "/preferences")).s === 401);
  ok("not signed in: write -> 401", (await call("PATCH", "/preferences", null, { theme: "DARK" })).s === 401);

  console.log("\n## 2. Default is light (nothing saved)");
  const first = await call("GET", "/preferences", A.tok);
  ok("a person who never chose has theme null (shown as light) and the store is ready", first.s === 200 && first.b.ready === true && first.b.theme === null, first);

  console.log("\n## 3. Saving");
  const dark = await call("PATCH", "/preferences", A.tok, { theme: "DARK" });
  ok("choosing dark -> 200", dark.s === 200 && dark.b.theme === "DARK", dark);
  ok("it is remembered", (await call("GET", "/preferences", A.tok)).b.theme === "DARK");
  ok("it survives signing in again (a new token, even from another device)", (await call("GET", "/preferences", await A.login())).b.theme === "DARK");
  ok("switching back to light is saved", (await call("PATCH", "/preferences", A.tok, { theme: "LIGHT" })).b.theme === "LIGHT" && (await call("GET", "/preferences", A.tok)).b.theme === "LIGHT");
  await call("PATCH", "/preferences", A.tok, { theme: "DARK" });
  await call("PATCH", "/preferences", A.tok, { theme: "DARK" });
  ok("repeated saves keep exactly one row", (await q(`select count(*)::int c from user_preferences where "userId"=$1`, [A.id]))[0].c === 1);

  console.log("\n## 4. One person's choice never affects another's");
  ok("B (never chose) still sees nothing saved while A is on dark", (await call("GET", "/preferences", B.tok)).b.theme === null);
  const sneaky = await call("PATCH", "/preferences", A.tok, { theme: "LIGHT", userId: B.id });
  ok("a userId sent in the body is ignored: it changes only the signed-in person", sneaky.s === 200 && (await call("GET", "/preferences", B.tok)).b.theme === null && (await call("GET", "/preferences", A.tok)).b.theme === "LIGHT");
  await call("PATCH", "/preferences", B.tok, { theme: "DARK" });
  ok("A and B hold different choices at the same time", (await call("GET", "/preferences", A.tok)).b.theme === "LIGHT" && (await call("GET", "/preferences", B.tok)).b.theme === "DARK");
  ok("there is no way to read or write another person's row by id (the id comes from the sign-in)", (await call("GET", `/preferences?userId=${B.id}`, A.tok)).b.theme === "LIGHT");

  console.log("\n## 5. Every role can choose");
  for (const [name, u] of [["manager", M], ["HR", H], ["Admin", AD], ["a person still on the first-login password screen", J]]) {
    const r = await call("PATCH", "/preferences", u.tok, { theme: "DARK" });
    ok(`${name} can choose`, r.s === 200 && (await call("GET", "/preferences", u.tok)).b.theme === "DARK", r);
  }

  console.log("\n## 6. Validation");
  for (const [name, body] of [["an unknown theme", { theme: "BLUE" }], ["lower case", { theme: "dark" }], ["no theme", {}], ["a number", { theme: 1 }], ["an object", { theme: { a: 1 } }], ["null", { theme: null }], ["an empty body", undefined]]) {
    const r = await call("PATCH", "/preferences", A.tok, body);
    ok(`${name} -> 400`, r.s === 400, r);
  }
  ok("after all those refusals A's choice is unchanged", (await call("GET", "/preferences", A.tok)).b.theme === "LIGHT");
  ok("only light and dark exist in the database too (the CHECK constraint)", await (async () => { try { await q(`update user_preferences set theme='BLUE' where "userId"=$1`, [A.id]); return false; } catch { return true; } })());

  console.log("\n## 7. Housekeeping");
  await q(`delete from users where id=$1`, [B.id]);
  ok("deleting a person removes their preference with them", (await q(`select 1 from user_preferences where "userId"=$1`, [B.id])).length === 0);

  await wipe();
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
