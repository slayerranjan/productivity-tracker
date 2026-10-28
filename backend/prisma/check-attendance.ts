import { prisma } from "../src/lib/prisma.js";
import { getMonthAttendance } from "../src/modules/attendance/attendance.service.js";

const Y = Number(process.env.Y ?? 2026);
const M = Number(process.env.M ?? 10);
const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function main() {
  const top = await prisma.workSession.groupBy({
    by: ["userId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 3,
  });

  if (top.length === 0) {
    console.log("No work sessions at all. Clock somebody in first.");
    return;
  }

  for (const g of top) {
    const a = await getMonthAttendance(g.userId, Y, M);
    console.log("");
    console.log("=== " + a.name + " (" + (a.employeeCode ?? "-") + ")  " + a.monthLabel);
    console.log(
      "shift " + (a.shiftName ?? "none") + " @ " + (a.shiftStart ?? "-") +
      "  |  full>=" + a.thresholds.fullDayAfterHours + "h  half>=" +
      a.thresholds.halfDayAfterHours + "h  grace " +
      a.thresholds.lateLoginGraceMinutes + "m"
    );
    for (const d of a.days) {
      if (d.status === "FUTURE") continue;
      console.log([
        d.date,
        DOW[d.dayOfWeek],
        d.label.padEnd(9),
        "prod " + String(d.workedHours).padStart(5) + "h",
        "mtg " + String(d.meetingHours).padStart(5) + "h",
        "brk " + String(d.breakHours).padStart(5) + "h",
        "pay " + d.payableFraction,
        d.isLate ? "LATE " + d.lateByMinutes + "m" : "",
        d.note ?? "",
      ].join("  "));
    }
    console.log("totals:", a.totals);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
