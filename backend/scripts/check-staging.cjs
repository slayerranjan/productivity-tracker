// Checks backend/.env.staging is set up safely. Read-only. Prints NO secret: only the first 12 characters of each
// host and pass/fail lines.   cd backend && node scripts/check-staging.cjs
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const read = (f) => {
  const out = {};
  for (const line of fs.readFileSync(path.join(__dirname, "..", f), "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
};
const hostOf = (u) => { try { return new URL(u).host; } catch { return null; } };
let bad = 0;
const check = (name, cond, hint) => { if (!cond) bad++; console.log((cond ? "OK    " : "FIX   ") + name + (cond ? "" : "  -> " + hint)); };

let st;
try { st = read(".env.staging"); } catch { console.log("backend/.env.staging does not exist."); process.exit(1); }
let prod = {};
try { prod = read(".env"); } catch { /* no production file here is fine */ }

const direct = hostOf(st.DIRECT_URL), pooled = hostOf(st.DATABASE_URL), test = hostOf(st.TEST_DATABASE_URL);
const prodHost = hostOf(prod.DIRECT_URL || prod.DATABASE_URL || "");
const short = (h) => (h ? h.slice(0, 12) + "..." : "(not set)");

check("DIRECT_URL is filled in", !!direct, "paste the branch's direct connection string");
check("DATABASE_URL is filled in", !!pooled, "paste the branch's pooled connection string");
check("TEST_DATABASE_URL is filled in", !!test, "paste the same direct string");
check("TEST_DATABASE_URL equals DIRECT_URL (same branch)", !!test && test === direct, "they must be the same host");
check("pooled and direct are the SAME branch (hosts differ only by '-pooler')", !!direct && !!pooled && pooled.replace("-pooler", "") === direct, `direct ${short(direct)} vs pooled ${short(pooled)}`);
check("none of them is the production database", ![direct, pooled, test].includes(prodHost) && !/ep-crimson-queen/.test(`${direct}${pooled}${test}`), "this is the PRODUCTION host - use the branch");
const passOf = (u) => { try { return decodeURIComponent(new URL(u).password); } catch { return ""; } };
const prodPass = passOf(prod.DIRECT_URL || prod.DATABASE_URL || "");
const stagingPass = passOf(st.DIRECT_URL || "");
check(
  "staging database PASSWORD differs from production's",
  !!direct && !!stagingPass && !!prodPass && stagingPass !== prodPass,
  "a new Neon branch inherits production's role password: on the STAGING branch open Roles, reset the password of the role you use (or create a new role), then paste the new strings"
);
check("mail cannot leave this machine (no Brevo key, SMTP is localhost)", !st.BREVO_API_KEY && ["localhost", "127.0.0.1"].includes(st.SMTP_HOST) && !st.SMTP_USER && !st.SMTP_PASS, "clear BREVO_API_KEY, SMTP_USER and SMTP_PASS; SMTP_HOST=localhost");
check("staging uses its own JWT secret", !!st.JWT_SECRET && st.JWT_SECRET !== prod.JWT_SECRET, "must differ from production");
// Any port is fine as long as it is not production's (5001, or whatever backend/.env says); 5002 is often taken by another process.
check("backend port is set and is not the production port", !!st.PORT && /^[0-9]+$/.test(st.PORT) && st.PORT !== String(prod.PORT || "5001") && st.PORT !== "5001", "use a port other than production's, for example 5012");
let ignored = false;
try { execSync("git check-ignore -q backend/.env.staging", { cwd: path.join(__dirname, "..", ".."), stdio: "ignore" }); ignored = true; } catch { /* not ignored */ }
check("Git ignores backend/.env.staging", ignored, "add .env.* to .gitignore");

async function live() {
  if (bad) {
    console.log("\nLive connection test skipped until the items above are fixed.");
    return;
  }
  let Client;
  try { ({ Client } = require("pg")); } catch { check("pg is installed for the live test", false, "npm install in backend/"); return; }
  const c = new Client({ connectionString: st.TEST_DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await c.connect();
    const r = (await c.query("select current_database() as db, current_setting('neon.endpoint_id', true) as ep")).rows[0];
    check("connects to the staging branch", true, "");
    // Neon names the compute endpoint in the host (ep-xxxx-xxxx-xxxxxxxx). If the server reports its own endpoint id,
    // it must be the one in the URL we connected to, and it must not be production's.
    if (r.ep) {
      const hostEp = direct.split(".")[0].replace("-pooler", "");
      check("the server that answered IS the staging endpoint", r.ep === hostEp, "the answering endpoint does not match the staging URL");
      const prodEp = prodHost ? prodHost.split(".")[0].replace("-pooler", "") : "";
      check("...and is not the production endpoint", r.ep !== prodEp, "this is PRODUCTION");
    } else {
      console.log("note  the server does not report its endpoint id; the host-name checks above are what prove it is staging");
    }
    const n = (await c.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'")).rows[0].n;
    console.log(`      database "${r.db}" has ${n} tables in schema public (a fresh copy of production's structure is expected)`);
  } catch (e) {
    check("connects to the staging branch", false, `${e.code || "error"}: ${String(e.message).replace(/postgres(ql)?:\/\/\S+/gi, "[url hidden]").slice(0, 120)}`);
  } finally {
    await c.end().catch(() => {});
  }
}

console.log(`\nhosts (first 12 characters only): direct ${short(direct)} | pooled ${short(pooled)} | production ${short(prodHost)}`);
live().then(() => {
  console.log(bad ? `\n${bad} thing(s) to fix before running anything.` : "\nAll good. Tell me and I will start (nothing has been run yet).");
  process.exit(bad ? 1 : 0);
});
