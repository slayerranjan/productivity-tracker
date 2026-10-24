import { prisma } from "../src/lib/prisma.js";

const users = await prisma.user.findMany({
  where: { role: { not: "EMPLOYEE" } },
  select: {
    employeeCode: true,
    firstName: true,
    lastName: true,
    email: true,
    role: true,
    platform: { select: { name: true } },
  },
  orderBy: [{ role: "asc" }, { employeeCode: "asc" }],
});

console.log("");
console.log("CODE".padEnd(12) + "ROLE".padEnd(10) + "NAME".padEnd(26) + "COMPANY");
console.log("-".repeat(90));
for (const u of users) {
  console.log(
    String(u.employeeCode ?? "-").padEnd(12) +
    String(u.role).padEnd(10) +
    `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim().padEnd(26) +
    (u.platform?.name ?? "-")
  );
}
console.log("");
console.log("total non-employee accounts:", users.length);

await prisma.$disconnect();
