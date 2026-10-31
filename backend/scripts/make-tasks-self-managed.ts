// Turns a MANAGER's existing tasks that are still waiting for approval into self-managed tasks (approved by himself, no approval
// step, nobody else reviews them). Needs migration 20261101140000_manager_self_tasks applied first.
//
//   npx tsx scripts/make-tasks-self-managed.ts AI-01            dry run: lists exactly what would change, changes nothing
//   npx tsx scripts/make-tasks-self-managed.ts AI-01 --apply    writes a backup file, then changes them in ONE transaction
//
// Only that person's own tasks that are (a) waiting for approval, (b) not assigned to them by someone else, (c) not already
// self-managed and (d) not cancelled. Anything else is left exactly as it is. Stops (changes nothing) if anything is unexpected.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.js";

const code = process.argv[2];
const apply = process.argv.includes("--apply");
if (!code || code.startsWith("--")) {
  console.log("Usage: npx tsx scripts/make-tasks-self-managed.ts <EMPLOYEE-CODE> [--apply]");
  process.exit(1);
}

const user = await prisma.user.findFirst({ where: { employeeCode: code }, select: { id: true, firstName: true, lastName: true, role: true, status: true, platformId: true } });
if (!user) { console.log(`STOPPED: no one has the code ${code}. Nothing changed.`); process.exit(1); }
if (String(user.role) !== "MANAGER" || String(user.status) !== "ACTIVE") { console.log(`STOPPED: ${code} is ${user.role}/${user.status}; only an active MANAGER's tasks can be self-managed. Nothing changed.`); process.exit(1); }

try {
  await prisma.taskSelfDetail.findFirst({ select: { taskId: true } });
  await prisma.taskEvent.findFirst({ select: { id: true } });
} catch {
  console.log("STOPPED: the self-managed task tables do not exist in this database yet (migration 20261101140000_manager_self_tasks). Nothing changed.");
  process.exit(1);
}

const candidates = await prisma.dailyTask.findMany({
  where: { userId: user.id, approvalStatus: "PENDING", assignedById: null, status: { not: "CANCELLED" } },
  orderBy: { date: "asc" },
});
const already = new Set((await prisma.taskSelfDetail.findMany({ where: { taskId: { in: candidates.map((c) => c.id) } }, select: { taskId: true } })).map((r) => r.taskId));
const todo = candidates.filter((c) => !already.has(c.id));

console.log(`${user.firstName} ${user.lastName} (${code}): ${todo.length} task(s) waiting for approval would become self-managed:`);
for (const t of todo) console.log(`  ${t.date.toISOString().slice(0, 10)}  ${String(t.status).padEnd(11)} ${JSON.stringify(t.title.slice(0, 60))}`);
if (todo.length === 0) { console.log("Nothing to do."); process.exit(0); }

if (!apply) { console.log("\nDRY RUN: nothing changed. Run again with --apply to do it."); process.exit(0); }

const dir = join(homedir(), "productivity-backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `tasks-before-self-managed-${code}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ note: "daily_tasks rows before conversion; restore by setting approvalStatus back to PENDING, approvedById/approvedAt to null, and deleting the matching task_self_details rows", user: code, tasks: todo }, null, 2));
console.log(`\nBackup written: ${file}`);

const now = new Date();
const done = await prisma.$transaction(async (tx) => {
  const upd = await tx.dailyTask.updateMany({ where: { id: { in: todo.map((t) => t.id) }, approvalStatus: "PENDING", userId: user.id }, data: { approvalStatus: "APPROVED", approvedById: user.id, approvedAt: now, rejectionNote: null } });
  if (upd.count !== todo.length) throw new Error(`changed ${upd.count}, expected ${todo.length}: rolling back`);
  await tx.taskSelfDetail.createMany({ data: todo.map((t) => ({ taskId: t.id, platformId: user.platformId, userId: user.id })) });
  await tx.taskEvent.createMany({ data: todo.map((t) => ({ taskId: t.id, platformId: user.platformId, actorId: user.id, kind: "CREATED", note: "Became a self-managed task: no approval needed" })) });
  return upd.count;
});
console.log(`Converted ${done} task(s). They are now approved under ${code}'s own name and appear in no one's review queue.`);
process.exit(0);
