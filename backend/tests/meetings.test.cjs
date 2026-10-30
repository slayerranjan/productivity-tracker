// Meeting links: validation, privacy, invitations, edits, cancellation, oversight.
// Disposable Neon branch only (see _guard.cjs). Backend must run on :5002 against that branch.
require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const API = "http://localhost:5002/api";
require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);

const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b !== undefined ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j, raw: txt };
};
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
const PW = "Mtg@12345678";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const add = (s, n) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);

(async () => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  const q = async (s, p) => (await db.query(s, p)).rows;
  const AV = (await q(`select id from platforms where slug='avatar'`))[0].id;
  const AVN = (await q(`select id from platforms where slug='avance'`))[0].id;
  const hash = await bcrypt.hash(PW, 10);
  const wipe = async () => { await q(`delete from meetings where "organizerId" in (select id from users where "employeeCode" like 'MTG-%')`); await q(`delete from users where "employeeCode" like 'MTG-%'`); };
  await wipe();
  const mk = async (code, role, platformId = AV) => {
    await q(`insert into users (id,"platformId",email,"passwordHash","firstName","lastName","employeeCode",role,status,"mustChangePassword","trackerAccessEnabled","onboardingStatus","createdAt","updatedAt") values (gen_random_uuid(),$1,$2,$3,'Mtg',$4,$5,$6,'ACTIVE',false,true,'ACTIVE',now(),now())`, [platformId, code.toLowerCase() + "@mtg.test", hash, code.replace("MTG-", "T"), code, role]);
    const id = (await q(`select id from users where "employeeCode"=$1`, [code]))[0].id;
    const tok = (await call("POST", "/auth/login", null, { email: code, password: PW })).b.token;
    return { id, tok };
  };
  const O = await mk("MTG-O", "MANAGER"), A = await mk("MTG-A", "EMPLOYEE"), B = await mk("MTG-B", "EMPLOYEE"), C = await mk("MTG-C", "EMPLOYEE"), H = await mk("MTG-H", "HR"), AD = await mk("MTG-AD", "ADMIN"), X = await mk("MTG-X", "HR", AVN), XE = await mk("MTG-XE", "EMPLOYEE", AVN);
  const today = (await call("GET", "/tracker/timesheet", O.tok)).b.today;
  const D1 = add(today, 1), D2 = add(today, 2);
  const good = { title: "Quarterly review", description: "Agenda attached", date: D1, startTime: "10:00", endTime: "11:00", meetingUrl: "https://meet.google.com/abc-defg-hij", attendeeIds: [A.id, B.id] };

  console.log("\n## 1. Who can create");
  ok("no token -> 401", (await call("GET", "/meetings")).s === 401 && (await call("POST", "/meetings", null, good)).s === 401);
  ok("an employee cannot create a meeting -> 403", (await call("POST", "/meetings", A.tok, good)).s === 403);
  ok("an employee cannot read the people picker -> 403", (await call("GET", "/meetings/people", A.tok)).s === 403);
  ok("manager, HR and Admin can create", (await call("GET", "/meetings/people", O.tok)).s === 200 && (await call("GET", "/meetings/people", H.tok)).s === 200 && (await call("GET", "/meetings/people", AD.tok)).s === 200);
  const ppl = (await call("GET", "/meetings/people", O.tok)).b.people;
  ok("the people picker lists only this company (not other companies, not yourself)", ppl.every((p) => p.employeeCode !== "MTG-XE" && p.employeeCode !== "MTG-O") && ppl.some((p) => p.employeeCode === "MTG-A"));

  console.log("\n## 2. Validation");
  const bad = async (name, patch, status) => { const r = await call("POST", "/meetings", O.tok, { ...good, ...patch }); ok(name, r.s === status, r); };
  await bad("missing title -> 400", { title: "" }, 400);
  await bad("title too long -> 400", { title: "x".repeat(130) }, 400);
  await bad("description too long -> 400", { description: "x".repeat(1100) }, 400);
  await bad("impossible date -> 400", { date: "2026-02-31" }, 400);
  await bad("bad time format -> 400", { startTime: "25:00" }, 400);
  await bad("end before start -> 400", { startTime: "11:00", endTime: "10:00" }, 400);
  await bad("end equal to start -> 400", { startTime: "10:00", endTime: "10:00" }, 400);
  await bad("longer than 12 hours -> 400", { startTime: "06:00", endTime: "20:00" }, 400);
  await bad("in the past -> 400", { date: add(today, -2) }, 400);
  await bad("no attendees -> 400", { attendeeIds: [] }, 400);
  await bad("attendees not a list -> 400", { attendeeIds: "x" }, 400);
  await bad("an attendee from ANOTHER company -> 400", { attendeeIds: [A.id, XE.id] }, 400);
  await bad("garbage attendee id -> 400", { attendeeIds: ["not-a-uuid"] }, 400);
  await bad("more than 100 attendees -> 400", { attendeeIds: Array.from({ length: 101 }, (_, i) => "00000000-0000-0000-0000-" + String(i).padStart(12, "0")) }, 400);
  for (const [label, url] of [["plain http", "http://meet.google.com/x"], ["no scheme", "meet.google.com/abc"], ["javascript:", "javascript:alert(1)"], ["data:", "data:text/html,<script>1</script>"], ["file:", "file:///etc/passwd"], ["localhost", "https://localhost/x"], ["an IP address", "https://192.168.1.5/join"], ["embedded credentials", "https://user:pw@meet.google.com/x"], ["a single-word host", "https://intranet/x"], ["over 500 characters", "https://example.com/" + "a".repeat(500)], ["spaces", "https://exa mple.com"]]) await bad(`link refused: ${label}`, { meetingUrl: url }, 400);
  ok("nothing was saved by any rejected request", (await q(`select count(*)::int n from meetings where "organizerId"=$1`, [O.id]))[0].n === 0);

  console.log("\n## 3. Creating a meeting");
  const cr = await call("POST", "/meetings", O.tok, good);
  ok("organizer creates a meeting -> 200", cr.s === 200 && cr.b.id && cr.b.invited === 2, cr);
  const MID = cr.b.id;
  const row = (await q(`select to_char("startsAt",'YYYY-MM-DD"T"HH24:MI:SS') s, to_char("endsAt",'YYYY-MM-DD"T"HH24:MI:SS') e, provider, status, "meetingUrl" from meetings where id=$1`, [MID]))[0];
  ok("stored as exact UTC instants for the company's timezone (10:00-11:00 IST = 04:30-05:30Z)", row.s === `${D1}T04:30:00` && row.e === `${D1}T05:30:00`, row);
  ok("the Google Meet link is recognised", row.provider === "Google Meet" && row.status === "SCHEDULED");
  ok("attendees are saved", (await q(`select count(*)::int n from meeting_attendees where "meetingId"=$1`, [MID]))[0].n === 2);
  const g2 = await call("POST", "/meetings", O.tok, { ...good, title: "Teams call", date: D2, meetingUrl: "https://teams.microsoft.com/l/meetup-join/abc", attendeeIds: [A.id] });
  const z = await call("POST", "/meetings", O.tok, { ...good, title: "Zoom call", date: D2, startTime: "12:00", endTime: "13:00", meetingUrl: "https://acme.zoom.us/j/123456789", attendeeIds: [A.id] });
  const o3 = await call("POST", "/meetings", O.tok, { ...good, title: "Other provider", date: D2, startTime: "14:00", endTime: "15:00", meetingUrl: "https://whereby.com/room", attendeeIds: [A.id] });
  const n4 = await call("POST", "/meetings", O.tok, { ...good, title: "No link yet", date: D2, startTime: "16:00", endTime: "17:00", meetingUrl: "", attendeeIds: [A.id] });
  const provs = (await q(`select title,provider,"meetingUrl" from meetings where "organizerId"=$1 and title in ('Teams call','Zoom call','Other provider','No link yet')`, [O.id])).reduce((m, r) => ({ ...m, [r.title]: r.provider }), {});
  ok("Teams, Zoom and any other https link are recognised; a link is optional", g2.s === 200 && provs["Teams call"] === "Microsoft Teams" && provs["Zoom call"] === "Zoom" && provs["Other provider"] === "Other link" && n4.s === 200 && provs["No link yet"] === null, provs);
  await sleep(800);
  const notifA = await q(`select type,title,body,link from notifications where "userId"=$1 and data->>'meetingId'=$2`, [A.id, MID]);
  ok("each invited person gets an in-app notification with a link to the meeting", notifA.length === 1 && notifA[0].type === "MEETING_INVITED" && notifA[0].link === `/dashboard/meetings?id=${MID}` && /Quarterly review/.test(notifA[0].body) && /10:00 AM/.test(notifA[0].body), notifA);
  ok("the organizer and un-invited people get nothing", (await q(`select count(*)::int n from notifications where data->>'meetingId'=$1 and "userId" in ($2,$3)`, [MID, O.id, C.id]))[0].n === 0);

  console.log("\n## 4. Who can see it (privacy)");
  const mineO = (await call("GET", "/meetings", O.tok)).b;
  ok("the organizer sees it, with the link, attendees and Join info", mineO.meetings.some((m) => m.id === MID && m.isOrganizer && m.meetingUrl && m.attendees.length === 2 && m.provider === "Google Meet" && m.state === "upcoming"), mineO.meetings[0]);
  ok("an invited person sees it with the link and the attendee list", (await call("GET", "/meetings", A.tok)).b.meetings.some((m) => m.id === MID && m.meetingUrl && !m.isOrganizer && m.attendees.length === 2));
  ok("someone NOT invited does not see it in their list", !(await call("GET", "/meetings", C.tok)).b.meetings.some((m) => m.id === MID));
  ok("...nor open it by id (404, as if it does not exist)", (await call("GET", `/meetings/${MID}`, C.tok)).s === 404);
  ok("HR who is not invited cannot open the details either -> 404", (await call("GET", `/meetings/${MID}`, H.tok)).s === 404 && (await call("GET", `/meetings/${MID}`, AD.tok)).s === 404);
  ok("a person from another company cannot -> 404", (await call("GET", `/meetings/${MID}`, XE.tok)).s === 404 && (await call("GET", `/meetings/${MID}`, X.tok)).s === 404);
  ok("garbage meeting id -> 404", (await call("GET", "/meetings/not-a-uuid", A.tok)).s === 404);
  const ov = await call("GET", "/meetings/oversight", H.tok);
  const ovm = ov.b.meetings.find((m) => m.id === MID);
  ok("HR's oversight list shows title, organizer, time and head-count ONLY", ov.s === 200 && ovm && ovm.title === "Quarterly review" && ovm.attendeeCount === 2 && !("description" in ovm) && !("meetingUrl" in ovm) && !("attendees" in ovm), ovm);
  ok("the oversight list leaks no link or description anywhere in its raw output", !/meet\.google|Agenda attached/.test(ov.raw));
  ok("employees and managers cannot use oversight -> 403", (await call("GET", "/meetings/oversight", A.tok)).s === 403 && (await call("GET", "/meetings/oversight", O.tok)).s === 403);
  ok("HR of another company sees none of this company's meetings", !(await call("GET", "/meetings/oversight", X.tok)).b.meetings.some((m) => m.id === MID));

  console.log("\n## 5. Joining, tabs and states");
  const det = (await call("GET", `/meetings/${MID}`, A.tok)).b;
  ok("an attendee gets the link and provider to show a Join button", det.meetingUrl === "https://meet.google.com/abc-defg-hij" && det.provider === "Google Meet");
  const noLink = (await call("GET", "/meetings", A.tok)).b.meetings.find((m) => m.title === "No link yet");
  ok("a meeting without a link has nothing to join", noLink && noLink.meetingUrl === null);
  const past = await q(`insert into meetings (id,"platformId","organizerId",title,"startsAt","endsAt",status,"createdAt","updatedAt") values (gen_random_uuid(),$1,$2,'Old sync',now()-interval '3 hours',now()-interval '2 hours','SCHEDULED',now(),now()) returning id`, [AV, O.id]);
  await q(`insert into meeting_attendees (id,"meetingId","userId","addedAt") values (gen_random_uuid(),$1,$2,now())`, [past[0].id, A.id]);
  const tabs = async (scope) => (await call("GET", `/meetings?scope=${scope}`, A.tok)).b;
  ok("an ended meeting is under Past, not Upcoming", (await tabs("past")).meetings.some((m) => m.title === "Old sync" && m.state === "past") && !(await tabs("upcoming")).meetings.some((m) => m.title === "Old sync"));
  ok("tab counts are returned", (await tabs("upcoming")).counts.upcoming >= 5 && (await tabs("upcoming")).counts.past >= 1);
  ok("search by title", (await call("GET", "/meetings?q=quarterly", A.tok)).b.meetings.every((m) => /quarterly/i.test(m.title)));
  ok("unknown scope falls back safely", (await call("GET", "/meetings?scope=zzz", A.tok)).s === 200);

  console.log("\n## 6. Editing (organizer only)");
  ok("an attendee cannot edit -> 404", (await call("PATCH", `/meetings/${MID}`, A.tok, { title: "Hacked" })).s === 404);
  ok("HR cannot edit a meeting they do not organize -> 404", (await call("PATCH", `/meetings/${MID}`, H.tok, { title: "Hacked" })).s === 404 && (await call("PATCH", `/meetings/${MID}`, AD.tok, { title: "Hacked" })).s === 404);
  ok("invalid edits are refused (bad time, bad link, bad date, no attendees)", (await call("PATCH", `/meetings/${MID}`, O.tok, { endTime: "09:00" })).s === 400 && (await call("PATCH", `/meetings/${MID}`, O.tok, { meetingUrl: "http://x.com/y" })).s === 400 && (await call("PATCH", `/meetings/${MID}`, O.tok, { date: "2026-13-01" })).s === 400 && (await call("PATCH", `/meetings/${MID}`, O.tok, { attendeeIds: [] })).s === 400);
  ok("a refused edit changed nothing", (await q(`select title from meetings where id=$1`, [MID]))[0].title === "Quarterly review");
  const ed = await call("PATCH", `/meetings/${MID}`, O.tok, { title: "Quarterly review (moved)", startTime: "15:00", endTime: "16:00", meetingUrl: "https://zoom.us/j/999", attendeeIds: [A.id, C.id] });
  ok("the organizer changes the title, time, link and people", ed.s === 200, ed);
  const e = (await q(`select title,to_char("startsAt",'HH24:MI') s,provider from meetings where id=$1`, [MID]))[0];
  ok("the change is stored (15:00 IST = 09:30Z, now Zoom)", e.title === "Quarterly review (moved)" && e.s === "09:30" && e.provider === "Zoom", e);
  await sleep(1200);
  const notes = async (uid) => (await q(`select type from notifications where "userId"=$1 and data->>'meetingId'=$2 order by "createdAt"`, [uid, MID])).map((r) => r.type);
  ok("people who stay are told it changed", (await notes(A.id)).includes("MEETING_UPDATED"), await notes(A.id));
  ok("newly added people are invited", (await notes(C.id)).join() === "MEETING_INVITED", await notes(C.id));
  ok("removed people are told, and it disappears for them", (await notes(B.id)).includes("MEETING_REMOVED") && !(await call("GET", "/meetings", B.tok)).b.meetings.some((m) => m.id === MID) && (await call("GET", `/meetings/${MID}`, B.tok)).s === 404);
  ok("the newly added person can now open it", (await call("GET", `/meetings/${MID}`, C.tok)).s === 200);
  ok("editing a meeting that already ended -> 409", (await call("PATCH", `/meetings/${past[0].id}`, O.tok, { title: "Late edit" })).s === 409);
  await sleep(800);
  const aud = (await q(`select action,before,after,summary from audit_logs where "recordId"=$1 order by "createdAt"`, [MID]));
  ok("create and edit are audited, the edit with before/after", aud.length >= 2 && aud[0].action === "CREATE" && aud.some((r) => r.action === "UPDATE" && r.before.title === "Quarterly review" && r.after.title === "Quarterly review (moved)"), aud.map((r) => [r.action, r.summary]));

  console.log("\n## 7. Cancelling");
  ok("an attendee cannot cancel -> 404", (await call("POST", `/meetings/${MID}/cancel`, A.tok, {})).s === 404);
  ok("HR of another company cannot cancel -> 404", (await call("POST", `/meetings/${MID}/cancel`, X.tok, {})).s === 404);
  const hrCancel = await call("POST", `/meetings/${g2.b.id}/cancel`, H.tok, { reason: "Room unavailable" });
  ok("HR/Admin can cancel any meeting in their company (oversight)", hrCancel.s === 200, hrCancel);
  const cn = (await call("GET", "/meetings?scope=cancelled", A.tok)).b;
  ok("it moves to the Cancelled tab, and its link is withheld", cn.meetings.some((m) => m.id === g2.b.id && m.state === "cancelled" && m.meetingUrl === null && m.cancelReason === "Room unavailable"), cn.meetings);
  await sleep(800);
  ok("attendees are told, with the reason", (await q(`select body from notifications where "userId"=$1 and type='MEETING_CANCELLED' and data->>'meetingId'=$2`, [A.id, g2.b.id]))[0]?.body.includes("Room unavailable"));
  ok("cancelling again -> 409", (await call("POST", `/meetings/${g2.b.id}/cancel`, O.tok, {})).s === 409);
  ok("editing a cancelled meeting -> 409", (await call("PATCH", `/meetings/${g2.b.id}`, O.tok, { title: "Revive" })).s === 409);
  ok("cancelling an ended meeting -> 409", (await call("POST", `/meetings/${past[0].id}/cancel`, O.tok, {})).s === 409);
  const race = await Promise.all([call("POST", `/meetings/${z.b.id}/cancel`, O.tok, {}), call("POST", `/meetings/${z.b.id}/cancel`, H.tok, {}), call("POST", `/meetings/${z.b.id}/cancel`, AD.tok, {})]);
  ok("three simultaneous cancels: exactly one wins, the others get 409", race.filter((r) => r.s === 200).length === 1 && race.filter((r) => r.s === 409).length === 2, race.map((r) => r.s));
  ok("organizer cancels their own", (await call("POST", `/meetings/${MID}/cancel`, O.tok, { reason: "Postponed" })).s === 200);
  await sleep(1000);
  const ca = (await q(`select action,before,after from audit_logs where "recordId"=$1 and action='CANCEL'`, [MID]))[0];
  ok("cancellations are audited with before/after", ca && ca.before.status === "SCHEDULED" && ca.after.status === "CANCELLED", ca);

  console.log("\n## 8. The database protects the data too");
  const t = async (sql, p) => { try { await q(sql, p); return "ALLOWED"; } catch (er) { return er.message; } };
  ok("a meeting cannot end before it starts (database rule)", /meetings_end_after_start/.test(await t(`update meetings set "endsAt"="startsAt" - interval '1 hour' where id=$1`, [MID])));
  ok("the same person cannot be added twice", /duplicate key/.test(await t(`insert into meeting_attendees (id,"meetingId","userId","addedAt") values (gen_random_uuid(),$1,$2,now())`, [MID, A.id])));
  ok("deleting a person removes them from meetings but keeps the meeting", await (async () => { const before = (await q(`select count(*)::int n from meetings where id=$1`, [MID]))[0].n; await q(`delete from users where id=$1`, [C.id]); return before === 1 && (await q(`select count(*)::int n from meetings where id=$1`, [MID]))[0].n === 1; })());

  await wipe();
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
