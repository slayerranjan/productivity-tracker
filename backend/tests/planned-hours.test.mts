// Planned hours = scheduled working days x productive hours per day, for managers and employees alike. No database.
import { plannedSecondsOf } from "../src/modules/tracker/timesheet.service.js";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n); };
const day = 8 * 3600;
const manager = { userId: "m", targetSeconds: 6 * day };
const employee = { userId: "e", targetSeconds: 5.5 * day }; // 5 days + a half-day leave
ok("manager: 6 scheduled days x 8h = 48h", plannedSecondsOf([manager], "m") === 48 * 3600);
ok("employee: half-day leave still owes half the target", plannedSecondsOf([employee], "e") === 44 * 3600);
ok("picks the right person from a list", plannedSecondsOf([employee, manager], "m") === 48 * 3600);
ok("no row (no working days) = 0, not an error", plannedSecondsOf([], "m") === 0);
ok("scales with days, not hardcoded (3 days = 24h)", plannedSecondsOf([{ userId: "m", targetSeconds: 3 * day }], "m") === 24 * 3600);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
