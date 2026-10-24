import { prisma } from "../src/lib/prisma.js";
import { getCandidate } from "../src/modules/onboarding/onboarding.service.js";

const admin = await prisma.user.findFirst({ where: { employeeCode: "TCS-03" }, select: { id: true } });
const rahul = await prisma.user.findFirst({ where: { employeeCode: "Test-22" }, select: { id: true } });

const res = await getCandidate(admin!.id, rahul!.id) as {
  checklist: { label: string; status: string; documentId?: string | null }[];
};

console.log("checklist the page receives:");
for (const c of res.checklist) {
  console.log("   " + String(c.label).padEnd(40) + String(c.status).padEnd(12) + (c.documentId ?? "no document id"));
}

await prisma.$disconnect();
