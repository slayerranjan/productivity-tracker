const { Client } = require("pg");
const API = (process.env.TEST_API ?? "http://localhost:5002/api");
const call = async (m, p, t, b) => {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; }
  return { s: r.status, b: j };
};
const login = async (e, p) => (await call("POST", "/auth/login", null, { email: e, password: p })).b.token;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  -> " + String(JSON.stringify(x)).slice(0, 300))); };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
(async () => {
  require("./_guard.cjs").assertTestDb(process.env.TEST_DATABASE_URL);
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect();
  await db.query(`delete from induction_documents where title like 'TEST %'`);
  const HR = await login("qa.hr@avatarindia.com", "QaHr@12345678"), P = await login("priya@avatarindia.com", process.env.TEST_PW_EMPLOYEE), R = await login("rahul@avatarindia.com", process.env.TEST_PW_EMPLOYEE), M = await login("manager@avatarindia.com", process.env.TEST_PW_MANAGER);
  ok("no token -> 401", (await call("GET", "/policies")).s === 401);
  ok("employee cannot upload -> 403", (await call("POST", "/policies", P, { category: "IT_POLICY", title: "TEST x", fileName: "a.pdf", data: PDF, mimeType: "application/pdf" })).s === 403);
  ok("employee cannot open the manage list -> 403", (await call("GET", "/policies/manage", P)).s === 403);
  ok("bad category -> 400", (await call("POST", "/policies", HR, { category: "NOPE", title: "TEST x", fileName: "a.pdf", data: PDF, mimeType: "application/pdf" })).s === 400);
  ok("no file -> 400", (await call("POST", "/policies", HR, { category: "IT_POLICY", title: "TEST x" })).s === 400);
  ok("executable file type refused -> 415", (await call("POST", "/policies", HR, { category: "IT_POLICY", title: "TEST x", fileName: "a.html", data: Buffer.from("<script>").toString("base64"), mimeType: "text/html" })).s === 415);
  const c = await call("POST", "/policies", HR, { category: "CODE_OF_CONDUCT", title: "TEST Code of conduct", description: "Read it", fileName: "coc.pdf", data: PDF, mimeType: "application/pdf" });
  ok("HR uploads a policy", c.s === 200 && c.b.id, c);
  const id = c.b.id;
  const team = (await db.query(`select t.id from teams t join team_members m on m."teamId"=t.id join users u on u.id=m."userId" where u.email='priya@avatarindia.com' and m."isActive" limit 1`)).rows[0];
  const other = (await db.query(`select id from teams where id<>$1 limit 1`, [team?.id ?? "00000000-0000-0000-0000-000000000000"])).rows[0];
  let tdoc = null;
  if (team) { tdoc = await call("POST", "/policies", HR, { category: "ROLE_TRAINING", title: "TEST Team only", teamId: team.id, fileName: "t.pdf", data: PDF, mimeType: "application/pdf" }); ok("HR limits a document to one team", tdoc.s === 200, tdoc); }
  const mine = await call("GET", "/policies", P);
  const doc = mine.b.documents.find((d) => d.id === id);
  ok("employee sees it, unread, and pending count includes it", doc && !doc.opened && !doc.acknowledgedAt && mine.b.pendingMandatory >= 1, mine.b);
  ok("team-only document is visible to a team member", !team || mine.b.documents.some((d) => d.id === tdoc.b.id));
  const rl = await call("GET", "/policies", R);
  ok("everyone in the company sees the company-wide document", rl.b.documents.some((d) => d.id === id));
  if (team) {
    const teamMembers = (await db.query(`select u.email from team_members m join users u on u.id=m."userId" where m."teamId"=$1 and m."isActive"`, [team.id])).rows.map((r) => r.email);
    ok("team-only document is hidden from people outside that team", teamMembers.includes("rahul@avatarindia.com") || !rl.b.documents.some((d) => d.id === tdoc.b.id), teamMembers);
  }
  ok("cannot accept before opening -> 400", (await call("POST", `/policies/${id}/acknowledge`, P)).s === 400);
  const f = await fetch(API + `/policies/${id}/file`, { headers: { authorization: "Bearer " + P } });
  const body = await f.text();
  ok("opening serves the file privately (no-store)", f.status === 200 && body.startsWith("%PDF") && /no-store/.test(f.headers.get("cache-control") ?? ""), f.status);
  const after = (await call("GET", "/policies", P)).b.documents.find((d) => d.id === id);
  ok("opening is recorded", after.opened === true && !after.acknowledgedAt);
  ok("accepting works after opening", (await call("POST", `/policies/${id}/acknowledge`, P)).s === 200);
  ok("accepting twice is harmless", (await call("POST", `/policies/${id}/acknowledge`, P)).b.already === true);
  const m1 = (await call("GET", "/policies/manage", HR)).b.documents.find((d) => d.id === id);
  ok("HR sees 1 accepted out of the audience", m1.accepted === 1 && m1.audience >= 2, m1);
  const rep = (await call("GET", `/policies/${id}/report`, HR)).b;
  const pr = rep.people.find((p) => p.name.startsWith("Priya")), rr = rep.people.find((p) => p.name.startsWith("Rahul"));
  ok("report shows who accepted (with time) and who has not", pr?.acknowledgedAt && rr && !rr.acknowledgedAt, rep.people.slice(0, 4));
  ok("employee cannot read the report -> 403", (await call("GET", `/policies/${id}/report`, P)).s === 403);
  const rp = await call("POST", `/policies/${id}/file`, HR, { fileName: "coc2.pdf", data: PDF, mimeType: "application/pdf" });
  ok("replacing the file bumps the version", rp.s === 200 && rp.b.version === 2, rp);
  const again = (await call("GET", "/policies", P)).b.documents.find((d) => d.id === id);
  ok("a new version must be accepted again", again.version === 2 && !again.acknowledgedAt && !again.opened, again);
  const keep = (await db.query(`select count(*)::int n from induction_acknowledgements where "inductionDocumentId"=$1 and "documentVersion"=1 and "acknowledgedAt" is not null`, [id])).rows[0].n;
  ok("the old acceptance is kept as history", keep === 1, keep);
  ok("manager cannot manage -> 403", (await call("POST", `/policies/${id}/archive`, M)).s === 403);
  ok("HR archives it", (await call("POST", `/policies/${id}/archive`, HR)).s === 200);
  ok("archived document disappears for employees", !(await call("GET", "/policies", P)).b.documents.some((d) => d.id === id));
  ok("archived document cannot be opened by an employee -> 404", (await fetch(API + `/policies/${id}/file`, { headers: { authorization: "Bearer " + P } })).status === 404);
  ok("HR restores it", (await call("POST", `/policies/${id}/restore`, HR)).s === 200 && (await call("GET", "/policies", P)).b.documents.some((d) => d.id === id));
  ok("changes are in the audit log", (await db.query(`select count(*)::int n from audit_logs where path like '/api/policies%'`)).rows[0].n > 0);
  await db.query(`delete from induction_documents where title like 'TEST %'`);
  console.log(`\n${pass} passed, ${fail} failed`); await db.end();
})().catch((e) => { console.error(e); process.exit(1); });
