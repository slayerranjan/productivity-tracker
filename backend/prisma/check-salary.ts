import { prisma } from "../src/lib/prisma.js";
import { generateMonth } from "../src/modules/payroll/payroll.generate.js";

const Y = Number(process.env.Y ?? 2026);
const M = Number(process.env.M ?? 10);
const KEEP = process.env.KEEP === "1";

async function main() {
  const actor = await prisma.user.findFirst({
    where: { role: { in: ["HR", "ADMIN"] }, status: "ACTIVE" },
    select: { id: true, employeeCode: true, role: true, platformId: true },
    orderBy: { employeeCode: "asc" },
  });

  if (!actor) {
    console.log("No active HR or ADMIN user found.");
    return;
  }
  console.log("running as " + (actor.employeeCode ?? "-") + " (" + actor.role + ")");

  // Which slips already existed, so the rollback only removes what this run made.
  const before = await prisma.salarySlip.findMany({
    where: { platformId: actor.platformId, month: M, year: Y },
    select: { id: true },
  });
  const beforeIds = new Set(before.map((s) => s.id));

  const r = await generateMonth(actor.id, M, Y);

  console.log(
    "month " + r.month + "/" + r.year +
    "  monthComplete=" + r.monthComplete +
    "  created=" + r.created + "  updated=" + r.updated
  );
  if (r.warning) console.log("WARNING: " + r.warning);
  console.log("");

  for (const s of r.slips) {
    console.log([
      (s.employeeCode ?? "-").padEnd(10),
      s.name.padEnd(20).slice(0, 20),
      "salary " + String(s.monthlySalary).padStart(8),
      "perDay " + String(s.perDayRate).padStart(7),
      "payable " + String(s.payableDays).padStart(5) + "/" + s.daysInMonth,
      "absent " + String(s.absentDays).padStart(5),
      "LOP " + String(s.lossOfPay).padStart(8),
      "NET " + String(s.netAmount).padStart(9),
    ].join("  "));
  }

  if (r.skipped.length > 0) {
    console.log("");
    console.log("skipped:");
    for (const k of r.skipped) {
      console.log("  " + (k.employeeCode ?? "-").padEnd(10) + k.name.padEnd(22).slice(0, 22) + k.reason);
    }
  }

  const totalNet = r.slips.reduce((a, s) => a + s.netAmount, 0);
  const totalGross = r.slips.reduce((a, s) => a + s.monthlySalary, 0);
  console.log("");
  console.log("slips " + r.slips.length + "   skipped " + r.skipped.length);
  console.log("total gross " + Math.round(totalGross * 100) / 100);
  console.log("total net   " + Math.round(totalNet * 100) / 100);

  const newIds = r.slips.map((s) => s.slipId).filter((id) => !beforeIds.has(id));
  if (KEEP) {
    console.log("");
    console.log("KEEP=1 — " + newIds.length + " new draft slips left in the database.");
  } else if (newIds.length > 0) {
    const del = await prisma.salarySlip.deleteMany({ where: { id: { in: newIds } } });
    console.log("");
    console.log("rolled back " + del.count + " draft slips (run with KEEP=1 to keep them).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
