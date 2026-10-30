// Safety guard shared by every test script.
// The tests WRITE data (users, sessions, leave, documents...). They must only ever run
// against a disposable Neon branch, never the database in backend/.env.
const fs = require("node:fs");
const path = require("node:path");

function liveHost() {
  try {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    const line = env.split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL=") || l.startsWith("DIRECT_URL="));
    return line ? new URL(line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")).host : null;
  } catch {
    return null;
  }
}

function assertTestDb(url) {
  if (!url) throw new Error("Set TEST_DATABASE_URL to the connection string of a disposable Neon BRANCH.");
  const host = new URL(url).host;
  const live = liveHost();
  if (live && host === live) throw new Error("REFUSING: TEST_DATABASE_URL points at the same database as backend/.env (" + host.slice(0, 20) + "...). Use a separate Neon branch.");
  return host;
}

module.exports = { assertTestDb };
