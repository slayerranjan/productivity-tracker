import { prisma } from "../src/lib/prisma.js";

const reqs = await prisma.documentRequirement.findMany({
  where: { isActive: true },
  select: {
    label: true,
    category: true,
    isMandatory: true,
    uploadedByEmployee: true,
    platform: { select: { name: true } },
  },
  orderBy: [{ platformId: "asc" }, { sortOrder: "asc" }],
});

let current = "";
for (const r of reqs) {
  const company = r.platform?.name ?? "-";
  if (company !== current) { console.log("\n" + company); current = company; }
  console.log(
    "   " + String(r.category).padEnd(22) +
    String(r.label).padEnd(38) +
    (r.uploadedByEmployee ? "joiner" : "HR    ") +
    (r.isMandatory ? "  mandatory" : "  optional")
  );
}

const resumes = reqs.filter((r) => String(r.category) === "RESUME");
console.log("\nRESUME requirements found:", resumes.length, "across", new Set(reqs.map(r => r.platform?.name)).size, "companies");

await prisma.$disconnect();
