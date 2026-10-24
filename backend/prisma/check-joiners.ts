import { prisma } from "../src/lib/prisma.js";
import { listCandidates } from "../src/modules/onboarding/onboarding.service.js";

console.log("OWNER_CODES =", JSON.stringify(process.env.OWNER_CODES ?? null));

const me = await prisma.user.findFirst({
  where: { employeeCode: "TCS-03" },
  select: { id: true, role: true, platform: { select: { name: true } } },
});
console.log("viewer      =", me?.role, "at", me?.platform?.name);

const rows = await listCandidates(me!.id);
console.log("page would show:", rows.length);
for (const r of rows) {
  console.log("   " + r.name + " | " + r.company + " | " + r.onboardingStatus +
    " | " + r.approved + " of " + r.mandatoryCount + " approved");
}

const raw = await prisma.user.findMany({
  where: { onboardingStatus: { not: "ACTIVE" } },
  select: { firstName: true, lastName: true, onboardingStatus: true, platform: { select: { name: true } } },
});
console.log("");
console.log("actually mid-onboarding in the database:", raw.length);
for (const r of raw) {
  console.log("   " + r.firstName + " " + r.lastName + " | " + r.platform?.name + " | " + r.onboardingStatus);
}

await prisma.$disconnect();
