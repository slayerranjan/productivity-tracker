import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

// ---------------------------------------------------------------------------
// WHY HOLIDAYS MATTER TO THIS SYSTEM
//
// Attainment accrues per scheduled working day. A holiday is NOT a working
// day, so it must not count towards anyone's target — otherwise every person
// looks like they under-delivered on Diwali. Reports already reads this
// table; until it has rows, Reports warns that holidays aren't configured.
//
// Each company declares its own list. Take Health may observe a holiday that
// Co-Lab works through, so the rows are seeded per platform rather than
// globally.
// ---------------------------------------------------------------------------

type Holiday = { month: number; day: number; name: string };

// Fixed-date national holidays. These do not move year to year, so they are
// safe to seed programmatically.
const NATIONAL_FIXED: Holiday[] = [
  { month: 1, day: 26, name: "Republic Day" },
  { month: 5, day: 1, name: "Maharashtra Day / Labour Day" },
  { month: 8, day: 15, name: "Independence Day" },
  { month: 10, day: 2, name: "Gandhi Jayanti" },
  { month: 12, day: 25, name: "Christmas" },
];

// ---------------------------------------------------------------------------
// FESTIVAL HOLIDAYS — YOU FILL THESE IN
//
// Diwali, Holi, Eid, Dussehra, Ganesh Chaturthi and Pongal follow lunar and
// regional calendars. I am deliberately NOT guessing them: a wrong date here
// silently inflates or deflates every person's attainment for that month,
// and nobody would notice until appraisals.
//
// Take the official list HR publishes for each company and add rows below in
// the same format. Re-running this script is safe — existing rows are left
// alone, new ones are added.
// ---------------------------------------------------------------------------
const FESTIVALS_2026: Holiday[] = [
  // { month: 11, day: 8, name: "Diwali" },
  // { month: 11, day: 9, name: "Diwali (second day)" },
];

const FESTIVALS_2027: Holiday[] = [
  // { month: 3, day: 3, name: "Holi" },
];

async function main() {
  const platforms = await prisma.platform.findMany({
    select: { id: true, name: true },
  });

  if (platforms.length === 0) {
    console.log("No companies found. Run the main seed first.");
    return;
  }

  const planned: { year: number; list: Holiday[] }[] = [
    { year: 2026, list: [...NATIONAL_FIXED, ...FESTIVALS_2026] },
    { year: 2027, list: [...NATIONAL_FIXED, ...FESTIVALS_2027] },
  ];

  let created = 0;
  let skipped = 0;

  for (const platform of platforms) {
    for (const { year, list } of planned) {
      for (const h of list) {
        // @db.Date columns are stored as UTC midnight. Building the date any
        // other way shifts it by a day in Asia/Kolkata and the holiday lands
        // on the wrong calendar day.
        const date = new Date(Date.UTC(year, h.month - 1, h.day));

        // The unique key is [platformId, date, name], so an upsert makes this
        // script safe to run as many times as you like.
        const existing = await prisma.holiday.findFirst({
          where: { platformId: platform.id, date, name: h.name },
          select: { id: true },
        });

        if (existing) {
          skipped += 1;
          continue;
        }

        await prisma.holiday.create({
          data: {
            platformId: platform.id,
            date,
            name: h.name,
            // dayType omitted on purpose — the schema defaults it to
            // PUBLIC_HOLIDAY, which is what all of these are.
          },
        });
        created += 1;
      }
    }
  }

  console.log(`Companies: ${platforms.map((p) => p.name).join(", ")}`);
  console.log(`Holidays created: ${created}`);
  console.log(`Already present, left alone: ${skipped}`);
  console.log(
    "Festival dates are commented out in this file — fill them from HR's official list per company."
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });