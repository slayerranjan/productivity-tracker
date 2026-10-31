// Manager self-managed tasks: the pure rules (time spent, overdue), no database. Synthetic times only.
//   cd backend && DATABASE_URL=postgresql://u:p@127.0.0.1:1/x npx tsx tests/self-task-logic.test.mts
import { taskWorkSeconds } from "../src/modules/tracker/productiveBreakdown.js";
import { isOverdue, dueEnd } from "../src/modules/tasks/tasks.self.logic.js";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(extra))); };
const at = (hhmm: string, day = "02") => new Date(`2026-11-${day}T${hhmm}:00.000Z`);
const MIN = 60, H = 3600;
const base = { loginAt: at("09:00"), logoutAt: at("18:00") as Date | null, breaks: [{ startedAt: at("13:00"), endedAt: at("14:00") }], now: at("19:00") };

console.log("\n## time spent on a task");
ok("started 10:00, completed 11:30, all inside clock-in: 1h30", taskWorkSeconds({ ...base, startedAt: at("10:00"), completedAt: at("11:30") }) === 90 * MIN);
ok("a task spanning the lunch break excludes exactly the break", taskWorkSeconds({ ...base, startedAt: at("12:30"), completedAt: at("14:30") }) === 1 * H);
ok("started before clock-in: only the part after clock-in counts", taskWorkSeconds({ ...base, startedAt: at("08:30"), completedAt: at("09:30") }) === 30 * MIN);
ok("completed after clock-out: only the part before counts", taskWorkSeconds({ ...base, startedAt: at("17:30"), completedAt: at("19:00") }) === 30 * MIN);
ok("entirely outside clock-in: zero (not null, it was measured)", taskWorkSeconds({ ...base, startedAt: at("06:00"), completedAt: at("07:00") }) === 0);
ok("never started: no reliable figure (null)", taskWorkSeconds({ ...base, startedAt: null, completedAt: at("11:00") }) === null);
ok("never completed: no figure (null)", taskWorkSeconds({ ...base, startedAt: at("10:00"), completedAt: null }) === null);
ok("no clocked-in session that day: no figure (null)", taskWorkSeconds({ ...base, loginAt: null, startedAt: at("10:00"), completedAt: at("11:00") }) === null);
ok("completed at or before it was started: no figure (null)", taskWorkSeconds({ ...base, startedAt: at("11:00"), completedAt: at("10:00") }) === null && taskWorkSeconds({ ...base, startedAt: at("11:00"), completedAt: at("11:00") }) === null);
ok("a day still running: measured up to now", taskWorkSeconds({ ...base, logoutAt: null, now: at("12:00"), breaks: [], startedAt: at("10:00"), completedAt: at("11:00") }) === 1 * H);
ok("never more than the task's own length", taskWorkSeconds({ ...base, startedAt: at("10:00"), completedAt: at("10:20") }) === 20 * MIN);

console.log("\n## overdue: the deadline day has passed (end of that company day) and the task is not completed");
const tz = "Asia/Kolkata";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const when = (localIso: string) => new Date(new Date(`${localIso}+05:30`).getTime());
ok("the deadline is the END of that day in the company timezone", dueEnd(day("2026-11-02"), tz).getTime() === when("2026-11-02T23:59:59.999").getTime() + 0 || Math.abs(dueEnd(day("2026-11-02"), tz).getTime() - when("2026-11-03T00:00:00")) <= 1000, dueEnd(day("2026-11-02"), tz));
ok("on the deadline day it is NOT overdue", isOverdue({ dueDate: day("2026-11-02"), status: "IN_PROGRESS" }, when("2026-11-02T23:00:00"), tz) === false);
ok("the next day it IS overdue", isOverdue({ dueDate: day("2026-11-02"), status: "IN_PROGRESS" }, when("2026-11-03T00:30:00"), tz) === true);
ok("a not-started task past its deadline is overdue too", isOverdue({ dueDate: day("2026-11-02"), status: "PENDING" }, when("2026-11-04T10:00:00"), tz) === true);
ok("a completed task is never overdue", isOverdue({ dueDate: day("2026-11-02"), status: "COMPLETED" }, when("2026-11-09T10:00:00"), tz) === false);
ok("a cancelled task is never overdue", isOverdue({ dueDate: day("2026-11-02"), status: "CANCELLED" }, when("2026-11-09T10:00:00"), tz) === false);
ok("no deadline is never overdue", isOverdue({ dueDate: null, status: "PENDING" }, when("2027-01-01T10:00:00"), tz) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
