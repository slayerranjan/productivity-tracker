import { prisma } from "../src/lib/prisma.js";

const rows = await prisma.$queryRaw<{ employeeCode: string; n: bigint }[]>`
  SELECT "employeeCode", COUNT(*) AS n
  FROM users
  WHERE "employeeCode" IS NOT NULL
  GROUP BY "employeeCode"
  HAVING COUNT(*) > 1
  ORDER BY n DESC
`;

if (rows.length === 0) {
  console.log("CLEAR - no duplicate employee codes. Safe to apply.");
} else {
  console.log("DUPLICATES FOUND - fix these before migrating:");
  for (const r of rows) console.log("  " + r.employeeCode + " -> " + r.n + " users");
}

await prisma.$disconnect();
