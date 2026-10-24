import { prisma } from "../src/lib/prisma.js";

const rahul = await prisma.user.findFirst({
  where: { employeeCode: "Test-22" },
  select: { id: true, platformId: true, platform: { select: { name: true } } },
});
console.log("Rahul is in:", rahul?.platform?.name);

const reqs = await prisma.documentRequirement.findMany({
  where: { platformId: rahul!.platformId },
  select: { id: true, label: true, isActive: true },
  orderBy: { label: "asc" },
});
console.log("requirement records for that company:", reqs.length);

const docs = await prisma.employeeDocument.findMany({
  where: { userId: rahul!.id },
  select: { requirementId: true, status: true, fileName: true },
});
console.log("documents he uploaded:", docs.length);

console.log("");
for (const d of docs) {
  const match = reqs.find((r) => r.id === d.requirementId);
  console.log(
    "  " + String(d.fileName).padEnd(28) +
    String(d.status).padEnd(11) +
    (match ? "matches: " + match.label : "NO MATCHING REQUIREMENT")
  );
}

await prisma.$disconnect();
