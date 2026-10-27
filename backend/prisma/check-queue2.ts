import { prisma } from "../src/lib/prisma.js";
import { listForApproval } from "../src/modules/tasks/tasks.service.js";

for (const code of ["SSB-01", "AI-01"]) {
  const m = await prisma.user.findFirst({
    where: { employeeCode: code },
    select: { id: true, firstName: true, role: true, platform: { select: { name: true } } },
  });
  if (!m) continue;
  const q = await listForApproval(m.id) as {
    teamSize?: number; members?: { name?: string }[]; all?: unknown[];
  };
  console.log(code, m.firstName, "|", m.role, "|", m.platform?.name,
    "=> teamSize:", q.teamSize, " tasks seen:", (q.all ?? []).length);
  for (const p of (q.members ?? []).slice(0, 12)) console.log("      ", JSON.stringify(p).slice(0, 90));
}

await prisma.$disconnect();
