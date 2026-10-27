import { prisma } from "../src/lib/prisma.js";

const emp = await prisma.user.findFirst({
  where: { firstName: { contains: "Vishwaa", mode: "insensitive" } },
  select: { id: true, firstName: true, employeeCode: true },
});

const tasks = await prisma.dailyTask.findMany({
  where: { userId: emp!.id },
  select: {
    title: true, date: true, status: true, approvalStatus: true,
    team: { select: { name: true } },
    approvedBy: { select: { firstName: true, employeeCode: true } },
    assignedBy: { select: { firstName: true, employeeCode: true } },
  },
  orderBy: { date: "desc" },
  take: 10,
});

console.log("tasks found:", tasks.length);
for (const t of tasks) {
  console.log(
    "  " + String(t.title).slice(0, 30).padEnd(32) +
    "status=" + String(t.status).padEnd(12) +
    "approval=" + String(t.approvalStatus).padEnd(12) +
    "team=" + String(t.team?.name ?? "none").padEnd(20) +
    "approvedBy=" + String(t.approvedBy?.employeeCode ?? "-")
  );
}

await prisma.$disconnect();
