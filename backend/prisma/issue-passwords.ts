import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";

const COMPANIES = ["Avatar", "Avatar India", "TC Software"];

// Only people who have never signed in. Anyone already using their own
// password keeps it - reissuing would lock them out of a working account.
const people = await prisma.user.findMany({
  where: {
    lastLoginAt: null,
    status: { not: "EXITED" },
    platform: { name: { in: COMPANIES } },
  },
  select: {
    id: true, firstName: true, lastName: true, employeeCode: true,
    platform: { select: { name: true } },
  },
  orderBy: [{ platformId: "asc" }, { employeeCode: "asc" }],
});

const lines: string[] = [];
let company = "";

for (const p of people) {
  const pwd = randomBytes(4).toString("hex") + "@" + Math.floor(10 + Math.random() * 89);
  await prisma.user.update({
    where: { id: p.id },
    data: { passwordHash: await bcrypt.hash(pwd, 10), mustChangePassword: true },
  });

  const c = p.platform?.name ?? "-";
  if (c !== company) { lines.push(""); lines.push(c); company = c; }
  lines.push(
    "  " + String(p.employeeCode).padEnd(12) +
    (String(p.firstName ?? "") + " " + String(p.lastName ?? "")).trim().padEnd(26) + pwd
  );
}

console.log(lines.join("\n"));
console.log("");
console.log("issued:", people.length, "- each works once, then they set their own.");

await prisma.$disconnect();
