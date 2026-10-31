// One-off: open the tracker for joiners who were locked until HR approved their papers.
//
//   npx tsx scripts/unlock-joiners.ts           dry run: lists who would be unlocked, writes nothing
//   npx tsx scripts/unlock-joiners.ts --apply   unlocks them
//
// New accounts are now created with the tracker open (documents are uploaded under My Profile and
// approved later). This applies the same rule to people created before that change. It touches ONLY
// active-type accounts that are locked and not suspended/exited. Their onboardingStatus is left
// alone, so HR still sees them in Joiners until their documents are approved. Back up first.
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const apply = process.argv.includes("--apply");
const host = new URL(String(process.env.DIRECT_URL ?? process.env.DATABASE_URL)).host;
console.log(`database: ${host.slice(0, 24)}...  mode: ${apply ? "APPLY" : "dry run"}`);

const people = await prisma.user.findMany({
  where: { trackerAccessEnabled: false, status: { in: ["CANDIDATE", "INVITED", "ACTIVE"] } },
  select: { id: true, employeeCode: true, firstName: true, lastName: true, status: true, onboardingStatus: true, platform: { select: { name: true } } },
  orderBy: [{ platformId: "asc" }, { employeeCode: "asc" }],
});
console.log(`locked people: ${people.length}`);
for (const p of people) console.log(`  ${p.platform.name} | ${p.employeeCode ?? "no code"} | ${p.firstName} ${p.lastName} | ${p.status} / ${p.onboardingStatus}`);

if (apply && people.length > 0) {
  const ids = people.map((p) => p.id);
  // A CANDIDATE is excluded from reports and live views; they are real staff from now on.
  const promoted = await prisma.user.updateMany({ where: { id: { in: ids }, status: "CANDIDATE" }, data: { status: "INVITED" } });
  const res = await prisma.user.updateMany({
    where: { id: { in: ids }, trackerAccessEnabled: false },
    data: { trackerAccessEnabled: true, accessGrantedAt: new Date() },
  });
  console.log(`unlocked: ${res.count} (of which moved from CANDIDATE to INVITED: ${promoted.count})`);
}
await prisma.$disconnect();
