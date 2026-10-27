import { prisma } from "../src/lib/prisma.js";
import { listForApproval } from "../src/modules/tasks/tasks.service.js";

const m = await prisma.user.findFirst({ where: { employeeCode: "AI-01" }, select: { id: true } });
const q = await listForApproval(m!.id) as Record<string, unknown>;

for (const key of ["proposals", "toReview", "all"]) {
  const arr = (q[key] as unknown[]) ?? [];
  console.log("");
  console.log("--- " + key + " (" + arr.length + ") ---");
  if (arr[0]) console.log(JSON.stringify(arr[0], null, 2));
}

await prisma.$disconnect();
