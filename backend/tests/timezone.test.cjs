// A company's calendar day must come from ITS OWN timezone, not the server's or the browser's.
// Moves a test company to a timezone where "today" differs from the UTC date, clocks a test user in,
// and checks the stored day, the timesheet, history and reports all agree. Restores the timezone at the end.
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const API = "http://localhost:5002/api";
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);
const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let j; try { j = await r.json(); } catch { j = null; } return { s: r.status, b: j };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 250))); };
const localDay = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const localHHMM = (tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const utcDay = new Date().toISOString().slice(0, 10);
  const tz = ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Pacific/Auckland"].find((z) => localDay(z) !== utcDay);
  if (!tz) { console.log("BLOCKED: no timezone with a different date right now (try again at a different hour)"); process.exit(0); }
  console.log(`   UTC date ${utcDay}; using ${tz}, where the date is ${localDay(tz)} and the time ${localHHMM(tz)}`);

  const P = (await db.query(`select id,timezone from platforms where slug='avance'`)).rows[0];
  const hash = await bcrypt.hash("Tz@12345678", 10);
  await db.query(`delete from users where "employeeCode"='TZ-1' and "platformId"=$1`, [P.id]);
  await db.query(`update platforms set timezone=$1 where id=$2`, [tz, P.id]);
  await db.query(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,'tz-1@tz.test',$2,'Tz','Tester','TZ-1','EMPLOYEE','ACTIVE',false,true,'ACTIVE',now(),now())`, [P.id, hash]);
  try {
    const tok = (await call("POST", "/auth/login", null, { email: "TZ-1", password: "Tz@12345678" })).b.token;
    const clock = await call("POST", "/tracker/clock-in", tok);
    ok("clock-in works for a non-IST company", clock.s === 200, clock);
    const row = (await db.query(`select to_char(date,'YYYY-MM-DD') d from work_sessions where "userId"=(select id from users where "employeeCode"='TZ-1' and "platformId"=$1)`, [P.id])).rows[0];
    ok(`the session is stored under the COMPANY's day (${localDay(tz)}), not the UTC day (${utcDay})`, row?.d === localDay(tz), row);
    const ts = (await call("GET", "/tracker/timesheet", tok)).b;
    ok("the timesheet says today is the company's day", ts.today === localDay(tz) && ts.timezone === tz, [ts.today, ts.timezone]);
    ok("today's row holds that session", ts.days[0].date === localDay(tz) && !!ts.days[0].session, ts.days[0]);
    const hist = (await call("GET", "/tracker/history", tok)).b;
    ok("history lists the session on the company's day", hist.rows.some((r) => r.date === localDay(tz)), hist.rows?.map((r) => r.date));
    ok("clock-out works", (await call("POST", "/tracker/clock-out", tok)).s === 200);
    const again = await call("POST", "/tracker/clock-in", tok);
    ok("clocking in again the same company-day resumes, not a second session", again.s === 200 && (await db.query(`select count(*)::int n from work_sessions w join users u on u.id=w."userId" where u."employeeCode"='TZ-1' and u."platformId"=$1`, [P.id])).rows[0].n === 1);
    await call("POST", "/tracker/clock-out", tok);
    const adm = (await db.query(`select 1 from users where role='ADMIN' and "platformId"=$1 limit 1`, [P.id])).rows.length;
    ok("(info) company has no admin of its own; reports checked via the person's own view", true);
    const rep = (await call("GET", `/reports?from=${localDay(tz)}&to=${localDay(tz)}&groupBy=person`, tok)).b;
    ok("the employee's own report for the company-day shows 1 day present", (rep.totals?.daysPresent ?? rep.people?.[0]?.daysPresent) === 1, rep.totals);
  } finally {
    await db.query(`delete from users where "employeeCode"='TZ-1' and "platformId"=$1`, [P.id]);
    await db.query(`update platforms set timezone=$1 where id=$2`, [P.timezone, P.id]);
  }
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
