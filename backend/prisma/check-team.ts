import { prisma } from "../src/lib/prisma.js";

const team = await prisma.team.findFirst({
  where: { name: { contains: "AI/ML" } },
  select: {
    id: true, name: true,
    platform: { select: { name: true } },
    manager: { select: { firstName: true, lastName: true, employeeCode: true } },
  },
});

console.log("team        :", team?.name, "-", team?.platform?.name);
console.log("team manager:", team?.manager
  ? team.manager.firstName + " " + team.manager.lastName + " (" + team.manager.employeeCode + ")"
  : "NONE");

await prisma.$disconnect();
