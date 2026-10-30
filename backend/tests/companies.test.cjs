const path = "";
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require(path + "pg");
const bcrypt = require(path + "bcryptjs");
const jwt = require(path + "jsonwebtoken");
const API = "http://localhost:5002/api";
const MODE = process.argv[2]; // "pinned" | "open"
const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j };
};
const login = async (id, pw) => (await call("POST", "/auth/login", null, { email: id, password: pw }));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
const PW = "Test@12345678";
(async () => {
  const BR = process.env.TEST_DATABASE_URL;
  require("./_guard.cjs").assertTestDb(BR);
  const db = new Client({ connectionString: BR }); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const AI = (await q(`select id from platforms where slug='avatar-india'`))[0].id;
  const AV = (await q(`select id from platforms where slug='avatar'`))[0].id;
  const hash = await bcrypt.hash(PW, 10);
  await q(`update users set "passwordHash"=$1,"mustChangePassword"=false,status='ACTIVE' where "employeeCode" in ('AI-01','AI-02','AI-03') and "platformId"=$2`, [hash, AI]);
  await q(`update users set role='HR' where "employeeCode"='AI-02' and "platformId"=$1`, [AI]);
  await q(`update users set role='MANAGER' where "employeeCode"='AI-01' and "platformId"=$1`, [AI]);
  await q(`update users set role='EMPLOYEE' where "employeeCode"='AI-03' and "platformId"=$1`, [AI]);
  const others = await q(`select id,"platformId" from users where "platformId"<>$1 and "platformId"<>$2 limit 3`, [AI, AV]);
  const aiCount = (await q(`select count(*)::int n from users where "platformId"=$1 and status<>'EXITED'`, [AI]))[0].n;
  const allCount = (await q(`select count(*)::int n from users where status<>'EXITED'`))[0].n;
  console.log(`   branch: Avatar India has ${aiCount} people; all companies ${allCount}`);

  if (MODE === "pinned") {
    console.log("\n## Pinned to avatar-india");
    const adminAV = await login("admin@avatarindia.com", process.env.TEST_PW_ADMIN);
    ok("an admin of ANOTHER company cannot sign in", adminAV.s === 401, adminAV);
    const secret = process.env.JWT_SECRET;
    const adminId = (await q(`select id from users where email='admin@avatarindia.com'`))[0].id;
    const forged = jwt.sign({ userId: adminId, platformId: AV, role: "ADMIN" }, secret, { expiresIn: "1h" });
    ok("even a valid token from another company is refused by the API (403)", (await call("GET", "/admin/users", forged)).s === 403);
    ok("...on every route", (await call("GET", "/tracker/session", forged)).s === 403 && (await call("GET", "/companies", forged)).s === 403 && (await call("GET", "/leave/mine", forged)).s === 403);
    const H = (await login("AI-02", PW)).b.token, M = (await login("AI-01", PW)).b.token, E = (await login("AI-03", PW)).b.token;
    ok("Avatar India people sign in with their employee code", H && M && E);

    const users = (await call("GET", "/admin/users", H)).b.users;
    ok("HR employee list = Avatar India people only", users.length === aiCount && users.every((u) => (u.platform?.id ?? u.platformId) === AI || u.platformId === undefined), [users.length, aiCount]);
    const ids = new Set(users.map((u) => u.id));
    ok("no employee from another company appears in the list", others.every((o) => !ids.has(o.id)));
    const opt = (await call("GET", "/admin/options", H)).b;
    const optIds = [...(opt.people ?? []), ...(opt.managers ?? [])].map((x) => x.id);
    const aiIds = new Set((await q(`select id from users where "platformId"=$1`, [AI])).map((r) => r.id));
    ok("admin dropdowns (managers/people) contain only Avatar India people", optIds.length > 0 && optIds.every((i) => aiIds.has(i)), optIds.length);
    const lk = (await call("GET", "/admin/employees/lookups", H)).b;
    ok("Add/Import employee company list = Avatar India only", (lk.platforms ?? lk.companies ?? []).length === 1, lk.platforms ?? lk.companies);
    const hol = (await call("GET", "/holidays", H)).b;
    ok("holiday company list = Avatar India only", (hol.companies ?? []).length === 1 && hol.companies[0].id === AI, hol.companies);
    const pr = (await call("GET", "/projects", H)).b;
    ok("projects: only Avatar India teams", (pr.companies ?? []).length === 1, pr.companies);
    const rep = (await call("GET", `/reports?from=2026-10-01&to=2026-10-28&groupBy=person`, H)).b;
    ok("reports list Avatar India people only", (rep.people ?? []).every((p) => ids.has(p.userId ?? p.id)), (rep.people ?? []).length);
    const ls = (await call("GET", "/leave/summary", H)).b;
    ok("leave summary = Avatar India people only", ls.people.length === aiCount && ls.people.every((p) => ids.has(p.id)));
    const cand = (await call("GET", "/onboarding/candidates", H)).b.candidates ?? [];
    ok("joiners list = Avatar India only", cand.every((c) => ids.has(c.id)));
    const team = (await call("GET", "/tracker/team", H)).b;
    ok("live team view = Avatar India only", (Array.isArray(team) ? team : team.rows ?? []).every((r) => ids.has(r.userId ?? r.id)), Object.keys(team).slice(0, 3));

    for (const o of others) {
      ok("direct request for another company's person is refused (leave history)", [403, 404].includes((await call("GET", `/leave/person/${o.id}`, H)).s));
      ok("...(joiner file)", [403, 404].includes((await call("GET", `/onboarding/candidates/${o.id}`, H)).s));
      ok("...(reports?userId=)", ((await call("GET", `/reports?from=2026-10-01&to=2026-10-28&groupBy=person&userId=${o.id}`, H)).b.people ?? []).length === 0);
    }
    ok("filter parameters cannot widen scope (?platformId=)", (await call("GET", `/admin/users?platformId=${others[0].platformId}`, H)).b.users.every((u) => ids.has(u.id)));

    console.log("\n## Company management");
    const l = await call("GET", "/companies", H);
    ok("HR can list companies", l.s === 200 && l.b.companies.length >= 13, l.s);
    ok("employee numbers only for the viewer's own company", l.b.companies.filter((c) => c.employees !== null).length === 1 && l.b.companies.find((c) => c.employees !== null).id === AI);
    ok("the pinned company is marked", l.b.pinnedTo?.id === AI && l.b.companies.find((c) => c.id === AI).isPinned);
    ok("manager cannot list companies -> 403", (await call("GET", "/companies", M)).s === 403);
    ok("employee cannot list companies -> 403", (await call("GET", "/companies", E)).s === 403);
    ok("manager cannot create -> 403", (await call("POST", "/companies", M, { name: "Zzz Nope" })).s === 403);
    ok("employee cannot edit -> 403", (await call("POST", "/companies/" + AI, E, { name: "Hacked" })).s === 403);
    ok("no token -> 401", (await call("GET", "/companies")).s === 401);
    ok("name too short -> 400", (await call("POST", "/companies", H, { name: "Z" })).s === 400);
    ok("duplicate name -> 409", (await call("POST", "/companies", H, { name: "avatar india" })).s === 409);
    ok("bad timezone -> 400", (await call("POST", "/companies", H, { name: "Zzz Test Co", timezone: "Mars/Base" })).s === 400);
    ok("bad prefix -> 400", (await call("POST", "/companies", H, { name: "Zzz Test Co", employeeCodePrefix: "a b!" })).s === 400);
    const cr = await call("POST", "/companies", H, { name: "Zzz Test Co", employeeCodePrefix: "ztc" });
    ok("HR creates a company (prefix upper-cased, slug made)", cr.s === 200 && cr.b.slug === "zzz-test-co", cr);
    const row = (await q(`select "employeeCodePrefix" p,"isActive" a from platforms where slug='zzz-test-co'`))[0];
    ok("new company is empty and active", row.p === "ZTC" && row.a === true && (await q(`select count(*)::int n from users where "platformId"=(select id from platforms where slug='zzz-test-co')`))[0].n === 0);
    ok("HR edits their own company", (await call("POST", "/companies/" + AI, H, { legalName: "Avatar India Pvt Ltd" })).s === 200);
    const zid = (await q(`select id from platforms where slug='zzz-test-co'`))[0].id;
    ok("HR cannot edit ANOTHER company -> 403", (await call("POST", "/companies/" + zid, H, { name: "Renamed" })).s === 403);
    ok("HR cannot deactivate their own company -> 400", (await call("POST", "/companies/" + AI, H, { isActive: false })).s === 400);
    ok("garbage company id -> 404 not 500", (await call("POST", "/companies/not-a-uuid", H, { name: "Xx" })).s === 404);
    ok("a company the pinned HR created is NOT in their employee data", (await call("GET", "/admin/users", H)).b.users.length === aiCount);
    await q(`delete from platforms where slug='zzz-test-co'`);
    await q(`update platforms set "legalName"=null where id=$1`, [AI]);
  } else {
    console.log("\n## Not pinned (today's behaviour)");
    const A = (await login("admin@avatarindia.com", process.env.TEST_PW_ADMIN)).b.token;
    ok("admin of another company still signs in", !!A);
    const H = (await login("AI-02", PW)).b.token;
    ok("HR sees their own company only (no pin needed)", (await call("GET", "/admin/users", H)).b.users.length === aiCount);
    const l = await call("GET", "/companies", A);
    ok("Admin lists companies", l.s === 200 && l.b.companies.length >= 13);
    const zc = await call("POST", "/companies", A, { name: "Zzz Admin Co" });
    ok("Admin creates a company", zc.s === 200);
    const zid = (await q(`select id from platforms where slug='zzz-admin-co'`))[0].id;
    ok("Admin edits ANOTHER company", (await call("POST", "/companies/" + zid, A, { name: "Zzz Admin Co 2" })).s === 200);
    ok("Admin can deactivate another company", (await call("POST", "/companies/" + zid, A, { isActive: false })).s === 200);
    ok("Admin cannot deactivate their own", (await call("POST", "/companies/" + AV, A, { isActive: false })).s === 400);
    const E = (await login("AI-03", PW)).b.token;
    ok("employee still refused -> 403", (await call("GET", "/companies", E)).s === 403);
    await q(`delete from platforms where slug='zzz-admin-co'`);
    // a deactivated company is closed to its people
    await q(`update platforms set "isActive"=false where id=$1`, [AI]);
    ok("a deactivated company is closed (403)", (await call("GET", "/leave/mine", H)).s === 403);
    await q(`update platforms set "isActive"=true where id=$1`, [AI]);
    ok("...and reopens when reactivated", (await call("GET", "/leave/mine", H)).s === 200);
  }
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
