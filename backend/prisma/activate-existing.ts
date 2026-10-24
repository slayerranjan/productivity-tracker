import { prisma } from "../src/lib/prisma.js";

// People genuinely mid-hiring right now. Everyone else sitting in OFFER_SENT
// is an existing employee the bulk import left in the wrong state.
const EXCLUDE = ["Test-22", "AWL-111"];

const stuck = await prisma.user.findMany({
  where: { onboardingStatus: "OFFER_SENT" },
  select: {
    employeeCode: true,
    firstName: true,
    lastName: true,
    platform: { select: { name: true } },
  },
  orderBy: { employeeCode: "asc" },
});

const toFix = stuck.filter((u) => !EXCLUDE.includes(String(u.employeeCode)));

console.log("WOULD ACTIVATE " + toFix.length + " existing employees:");
for (const u of toFix) {
  console.log(
    "   " + String(u.employeeCode).padEnd(11) +
    (String(u.firstName ?? "") + " " + String(u.lastName ?? "")).trim().padEnd(24) +
    String(u.platform?.name ?? "")
  );
}

console.log("");
console.log("LEFT AS JOINERS: " + EXCLUDE.join(", "));

if (process.env.APPLY === "1") {
  const result = await prisma.user.updateMany({
    where: { onboardingStatus: "OFFER_SENT", employeeCode: { notIn: EXCLUDE } },
    data: {
      onboardingStatus: "ACTIVE",
      status: "ACTIVE",
      trackerAccessEnabled: true,
      accessGrantedAt: new Date(),
    },
  });
  console.log("");
  console.log("APPLIED - " + result.count + " people activated.");
} else {
  console.log("");
  console.log("Nothing changed. Re-run with APPLY=1 to apply.");
}

await prisma.$disconnect();
