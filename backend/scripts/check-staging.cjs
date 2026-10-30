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
check("mail cannot leave this machine (no Brevo key, SMTP is localhost)", !st.BREVO_API_KEY && ["localhost", "127.0.0.1"].includes(st.SMTP_HOST) && !st.SMTP_USER && !st.SMTP_PASS, "clear BREVO_API_KEY, SMTP_USER and SMTP_PASS; SMTP_HOST=localhost");
check("staging uses its own JWT secret", !!st.JWT_SECRET && st.JWT_SECRET !== prod.JWT_SECRET, "must differ from production");
check("backend port is not the production port", st.PORT === "5002", "use 5002");
let ignored = false;
try { execSync("git check-ignore -q backend/.env.staging", { cwd: path.join(__dirname, "..", ".."), stdio: "ignore" }); ignored = true; } catch { /* not ignored */ }
check("Git ignores backend/.env.staging", ignored, "add .env.* to .gitignore");

console.log(`\nhosts (first 12 characters only): direct ${short(direct)} | pooled ${short(pooled)} | production ${short(prodHost)}`);
console.log(bad ? `\n${bad} thing(s) to fix before running anything.` : "\nAll good. Tell me and I will start (nothing has been run yet).");
process.exit(bad ? 1 : 0);
