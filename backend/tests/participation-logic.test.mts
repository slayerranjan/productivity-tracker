// In-person participation RULES: every boundary, with no database.
//
//   cd backend && DATABASE_URL=postgresql://u:p@127.0.0.1:1/x npx tsx tests/participation-logic.test.mts
//
// (The DATABASE_URL is a dummy: nothing here connects to a database.)
import { joinWindow, isLate, isStillActivePastEnd, durationSeconds, stateOf, actualSpan, minutesAfterStart, JOIN_EARLY_MINUTES } from "../src/modules/meetings/participation.logic.js";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(extra))); };

const T = (hhmm: string, sec = 0) => new Date(`2026-11-02T${hhmm}:${String(sec).padStart(2, "0")}.000Z`);
const start = T("10:00");
const end = T("10:30");

console.log("\n## join window: 15 minutes before the start until the expected end");
ok("the early allowance is 15 minutes", JOIN_EARLY_MINUTES === 15);
ok("opens at exactly 09:45:00 (inclusive)", joinWindow(start, end, T("09:45")).open === true);
ok("09:44:59 is too early", joinWindow(start, end, T("09:44", 59)).reason === "TOO_EARLY" && !joinWindow(start, end, T("09:44", 59)).open);
ok("an hour before is too early", joinWindow(start, end, T("09:00")).reason === "TOO_EARLY");
ok("at the start it is open", joinWindow(start, end, start).open === true);
ok("mid-meeting it is open (a late joiner can still join)", joinWindow(start, end, T("10:20")).open === true);
ok("exactly at the expected end it is still open (inclusive)", joinWindow(start, end, end).open === true);
ok("one second after the end it is CLOSED", joinWindow(start, end, T("10:30", 1)).reason === "CLOSED" && !joinWindow(start, end, T("10:30", 1)).open);
ok("hours later it is closed", joinWindow(start, end, T("14:00")).reason === "CLOSED");
const w = joinWindow(start, end, T("09:00"));
ok("the window reports when it opens and closes", w.opensAt.getTime() === T("09:45").getTime() && w.closesAt.getTime() === end.getTime());

console.log("\n## late joiner: more than N minutes after the start");
ok("exactly on the line (5 min) is on time", isLate(T("10:05"), start, 5) === false);
ok("one second past the line is late", isLate(T("10:05", 1), start, 5) === true);
ok("joining early is not late", isLate(T("09:50"), start, 5) === false);
ok("N = 0: exactly at the start is on time, one second after is late", isLate(start, start, 0) === false && isLate(T("10:00", 1), start, 0) === true);
ok("the threshold is per meeting (15 min)", isLate(T("10:14"), start, 15) === false && isLate(T("10:16"), start, 15) === true);
ok("minutes after the start rounds down, never below 0", minutesAfterStart(T("10:07", 59), start) === 7 && minutesAfterStart(T("09:55"), start) === 0);

console.log("\n## still active past the expected end (flag only)");
ok("joined, not ended, before the end: not flagged", isStillActivePastEnd({ leftAt: null }, end, T("10:29")) === false);
ok("joined, not ended, at the end: not flagged yet", isStillActivePastEnd({ leftAt: null }, end, end) === false);
ok("joined, not ended, one second after the end: FLAGGED", isStillActivePastEnd({ leftAt: null }, end, T("10:30", 1)) === true);
ok("ended people are never flagged", isStillActivePastEnd({ leftAt: T("10:10") }, end, T("12:00")) === false);

console.log("\n## state and duration");
ok("no record = NOT_JOINED (never presumed present)", stateOf(null) === "NOT_JOINED");
ok("joined and not left = IN_MEETING", stateOf({ leftAt: null }) === "IN_MEETING");
ok("left = ENDED", stateOf({ leftAt: T("10:10") }) === "ENDED");
ok("duration in whole seconds", durationSeconds(T("10:01"), T("10:17", 30)) === 16 * 60 + 30);
ok("duration never negative", durationSeconds(T("10:10"), T("10:00")) === 0);

console.log("\n## the actual length of the meeting (as declared)");
ok("nobody joined = no length", actualSpan([], T("11:00")) === null);
const span = actualSpan([{ joinedAt: T("10:02"), leftAt: T("10:20") }, { joinedAt: T("10:00", 30), leftAt: T("10:25") }], T("12:00"));
ok("first declared join to last declared exit", span?.seconds === 24 * 60 + 30 && span.ongoing === false, span);
const live = actualSpan([{ joinedAt: T("10:00"), leftAt: T("10:20") }, { joinedAt: T("10:05"), leftAt: null }], T("10:40"));
ok("someone still in: runs to now and says it is ongoing", live?.seconds === 40 * 60 && live.ongoing === true, live);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
