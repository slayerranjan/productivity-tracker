import { prisma } from "../src/lib/prisma.js";

// Who should approve, and for whom.
const MANAGER_CODE = "AI-01";                       // Ankit Kale
const EMPLOYEE_CODES = ["AI-02", "TCS-02", "TCS-01"]; // Vishwaa, Nikhil, Vinayak

const manager = await prisma.user.findFirst({
  where: { employeeCode: MANAGER_CODE },
  select: { id: true, firstName: true, lastName: true, role: true },
});
if (!manager) throw new Error("manager not found: " + MANAGER_CODE);

console.log("manager:", manager.firstName, manager.lastName, "(" + manager.role + ")");
console.log("");

for (const code of EMPLOYEE_CODES) {
  const u = await prisma.user.findFirst({
    where: { employeeCode: code },
    select: { id: true, firstName: true, lastName: true,
              reportsTo: { select: { employeeCode: true } } },
  });
  if (!u) { console.log("  " + code + " NOT FOUND"); continue; }

  console.log("  " + code.padEnd(10) + (u.firstName + " " + u.lastName).padEnd(22) +
    "was reporting to " + (u.reportsTo?.employeeCode ?? "nobody") + " -> " + MANAGER_CODE);

  if (process.env.APPLY === "1") {
    await prisma.user.update({ where: { id: u.id }, data: { reportsToId: manager.id } });
  }
}

// A manager must hold the MANAGER role or the approval screens refuse them.
if (process.env.APPLY === "1" && manager.role === "EMPLOYEE") {
  await prisma.user.update({ where: { id: manager.id }, data: { role: "MANAGER" } });
  console.log("");
  console.log("promoted " + MANAGER_CODE + " to MANAGER");
}

console.log("");
console.log(process.env.APPLY === "1" ? "APPLIED" : "Nothing changed. Re-run with APPLY=1.");

await prisma.$disconnect();
