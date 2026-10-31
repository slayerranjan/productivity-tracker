// Removes the 7 dummy "Test ..." joiner accounts from Colab Platforms Limited. Nothing else.
//
//   npx tsx scripts/remove-test-accounts.ts            dry run: shows exactly what would go, changes nothing
//   npx tsx scripts/remove-test-accounts.ts --apply    writes a backup file, then deletes in ONE transaction
//
// Safety: only these exact employee codes are considered, and every one must ALSO be named "Test ...", be INVITED,
// and have a "+test" email. If anything differs (a code is missing, a name does not match, a different number of
// accounts) the script stops and deletes nothing. Every table that points at these users is found automatically,
// shown, and copied into the backup. If any such table would block the delete, it stops.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.js";

const CODES = ["JAY-0002", "JAY-0003", "JAY-0004", "JAY-0005", "AI-11", "AI-12", "AI-13"];
const apply = process.argv.includes("--apply");

const users = await prisma.user.findMany({ where: { employeeCode: { in: CODES } } });
const problems: string[] = [];
if (users.length !== CODES.length) problems.push(`expected ${CODES.length} accounts, found ${users.length}`);
for (const u of users) {
  if (!/^test/i.test(u.firstName)) problems.push(`${u.employeeCode}: name "${u.firstName}" does not start with Test`);
  if (String(u.status) !== "INVITED") problems.push(`${u.employeeCode}: status is ${u.status}, not INVITED`);
  if (!/\+test/i.test(u.email ?? "")) problems.push(`${u.employeeCode}: email has no +test`);
}
if (problems.length) {
  console.log("STOPPED, nothing changed:\n - " + problems.join("\n - "));
  process.exit(1);
}
const ids = users.map((u) => u.id);
console.log(`Matched ${users.length} test accounts:`);
for (const u of users) console.log(`  ${String(u.employeeCode).padEnd(9)} ${`${u.firstName} ${u.lastName}`.trim().padEnd(14)} ${u.email}`);

// Every foreign key that points at users(id).
const fks = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; delete_rule: string }[]>(`
  SELECT kcu.table_name, kcu.column_name, rc.delete_rule
  FROM information_schema.referential_constraints rc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name AND ccu.constraint_schema = rc.unique_constraint_schema
  WHERE ccu.table_name = 'users' AND ccu.column_name = 'id' AND kcu.table_schema = 'public'
  ORDER BY kcu.table_name, kcu.column_name`);

const backup: Record<string, unknown[]> = { users: users as unknown[] };
const attached: { table: string; column: string; rule: string; rows: number }[] = [];
for (const fk of fks) {
  const rows = await prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${fk.table_name}" WHERE "${fk.column_name}" = ANY($1::uuid[])`, ids);
  if (rows.length) {
    attached.push({ table: fk.table_name, column: fk.column_name, rule: fk.delete_rule, rows: rows.length });
    backup[`${fk.table_name}.${fk.column_name}`] = rows;
  }
}
console.log(`Checked ${fks.length} tables that point at users.`);
if (attached.length === 0) console.log("Nothing else is attached to these accounts.");
for (const a of attached) console.log(`  attached: ${a.table}.${a.column} = ${a.rows} row(s), on delete ${a.rule}`);

const blocking = attached.filter((a) => a.rule === "NO ACTION" || a.rule === "RESTRICT");
if (blocking.length) {
  console.log("STOPPED: these would block the delete or need a decision:", blocking.map((b) => `${b.table}.${b.column}`).join(", "));
  process.exit(1);
}

const before = await prisma.user.count();
if (!apply) {
  console.log(`\nDRY RUN. ${before} users now; after the delete there would be ${before - users.length}. Run again with --apply to do it.`);
  process.exit(0);
}

const dir = join(homedir(), "productivity-backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `test-accounts-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(backup, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(`\nBackup written: ${file}`);

const res = await prisma.$transaction(async (tx) => {
  const gone = await tx.user.deleteMany({ where: { id: { in: ids }, employeeCode: { in: CODES } } });
  if (gone.count !== CODES.length) throw new Error(`deleted ${gone.count}, expected ${CODES.length}: rolling back`);
  return gone.count;
});
const after = await prisma.user.count();
console.log(`Deleted ${res} accounts. Users: ${before} -> ${after}.`);
process.exit(0);
