import { prisma } from "../src/lib/prisma.js";
import { listForApproval } from "../src/modules/tasks/tasks.service.js";

const emp = await prisma.user.findFirst({
  where: { firstName: { contains: "Vishwaa", mode: "insensitive" } },
  select: { id: true },
});

const tasks = await prisma.dailyTask.findMany({
  where: { userId: emp!.id },
  select: { title: true, date: true, approvalStatus: true },
  orderBy: { date: "desc" },
  take: 10,
});

console.log("today (server):", new Date().toISOString().slice(0, 10));
console.log("");
for (const t of tasks) {
  console.log("  " + t.date.toISOString().slice(0, 10) + "  " +
    String(t.approvalStatus).padEnd(10) + String(t.title).slice(0, 40));
}

for (const code of ["SSB-01", "AI-01"]) {
  const m = await prisma.user.findFirst({ where: { employeeCode: code }, select: { id: true, firstName: true } });
  if (!m) continue;
  const q = await listForApproval(m.id) as { awaitingApproval?: unknown[]; proposals?: unknown[] };
  console.log("");
  console.log(code, m.firstName, "- awaiting:", (q.awaitingApproval ?? []).length,
    " proposals:", (q.proposals ?? []).length);
}

await prisma.$disconnect();
