// Productive-time breakdown: every rule and every boundary, with no database. Synthetic times only.
//
//   cd backend && DATABASE_URL=postgresql://u:p@127.0.0.1:1/x npx tsx tests/productive-breakdown.test.mts
import { computeBreakdown, merge, intersect, subtract, totalSeconds, type BreakdownInput } from "../src/modules/tracker/productiveBreakdown.js";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  -> " + JSON.stringify(extra))); };

const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00.000Z`);
const MIN = 60, H = 3600;
const lunch = { startedAt: at("13:00"), endedAt: at("14:00") };
const base = (over: Partial<BreakdownInput> = {}): BreakdownInput => ({ loginAt: at("09:00"), logoutAt: at("18:00"), breaks: [lunch], liveMeetings: [], huddles: [], now: at("19:00"), ...over });
const huddle = (id: string, join: string, left: string | null, expectedEnd: string) => ({ id, joinedAt: at(join), leftAt: left ? at(left) : null, expectedEnd: at(expectedEnd) });

const cases: Record<string, BreakdownInput> = {};
const check = (name: string, input: BreakdownInput, want: { huddle?: number; other?: number; regular?: number; productive?: number }) => {
  cases[name] = input;
  const r = computeBreakdown(input);
  const bad: Record<string, unknown> = {};
  if (want.huddle !== undefined && r.huddleSeconds !== want.huddle) bad.huddle = [r.huddleSeconds, want.huddle];
  if (want.other !== undefined && r.otherEligibleSeconds !== want.other) bad.other = [r.otherEligibleSeconds, want.other];
  if (want.regular !== undefined && r.regularSeconds !== want.regular) bad.regular = [r.regularSeconds, want.regular];
  if (want.productive !== undefined && r.productiveSeconds !== want.productive) bad.productive = [r.productiveSeconds, want.productive];
  ok(name, Object.keys(bad).length === 0, bad);
  return r;
};

console.log("\n## the example from the request: regular + huddle = total (same total as today)");
const ex = check("a 30-minute huddle inside the clocked-in day", base({ huddles: [huddle("a", "09:30", "10:00", "10:00")] }), { huddle: 30 * MIN, regular: 8 * H - 30 * MIN, productive: 8 * H });
ok("the three parts add up to the productive total", ex.regularSeconds + ex.huddleSeconds + ex.otherEligibleSeconds === ex.productiveSeconds);
ok("the total is exactly what the app already computes (clocked in 9h minus 1h lunch)", ex.productiveSeconds === (9 * H) - (1 * H));
check("someone who did not join gets zero huddle time and all regular", base(), { huddle: 0, other: 0, regular: 8 * H });

console.log("\n## only time inside clock-in counts");
const early = check("joined 15 minutes before clock-in: only the part after clock-in counts", base({ huddles: [huddle("a", "08:45", "09:15", "09:15")] }), { huddle: 15 * MIN });
ok("...the raw time is still reported", early.huddles[0].rawSeconds === 30 * MIN && early.huddles[0].countedSeconds === 15 * MIN, early.huddles);
check("a huddle entirely before clock-in counts zero", base({ huddles: [huddle("a", "07:00", "07:30", "07:30")] }), { huddle: 0, regular: 8 * H });
check("a huddle entirely after clock-out counts zero", base({ huddles: [huddle("a", "18:10", "18:40", "18:40")] }), { huddle: 0 });
check("never clocked in that day is impossible to count (clock-out before the huddle)", base({ loginAt: at("09:00"), logoutAt: at("09:10"), breaks: [], huddles: [huddle("a", "09:30", "10:00", "10:00")] }), { huddle: 0, productive: 10 * MIN });

console.log("\n## breaks are excluded");
check("a huddle straddling the end of lunch counts only the part after it", base({ huddles: [huddle("a", "13:30", "14:30", "14:30")] }), { huddle: 30 * MIN });
check("a huddle entirely inside a break counts zero", base({ huddles: [huddle("a", "13:10", "13:50", "13:50")] }), { huddle: 0 });
check("a huddle spanning a whole break excludes exactly the break", base({ huddles: [huddle("a", "12:30", "14:30", "14:30")] }), { huddle: 1 * H });
check("a break still running now removes that time (and a huddle inside it counts zero)", base({ logoutAt: null, now: at("12:00"), breaks: [{ startedAt: at("11:30"), endedAt: null }], huddles: [huddle("a", "11:40", "11:55", "11:55")] }), { huddle: 0, productive: 2.5 * H });

console.log("\n## nothing is counted twice");
const ov = check("two overlapping huddles count the union (45 min), not 60", base({ huddles: [huddle("a", "09:30", "10:00", "10:00"), huddle("b", "09:45", "10:15", "10:15")] }), { huddle: 45 * MIN });
ok("...each huddle still shows its own counted time", ov.huddles[0].countedSeconds === 30 * MIN && ov.huddles[1].countedSeconds === 30 * MIN, ov.huddles);
check("back-to-back huddles add up", base({ huddles: [huddle("a", "09:30", "10:00", "10:00"), huddle("b", "10:00", "10:30", "10:30")] }), { huddle: 1 * H });
check("the same huddle recorded twice counts once", base({ huddles: [huddle("a", "09:30", "10:00", "10:00"), huddle("a2", "09:30", "10:00", "10:00")] }), { huddle: 30 * MIN });
const withMeeting = check("an approved live meeting overlapping the huddle: huddle gets the overlap, 'other' only the rest", base({ huddles: [huddle("a", "09:30", "10:00", "10:00")], liveMeetings: [{ approvalStatus: "APPROVED", startedAt: at("09:40"), endedAt: at("10:10") }] }), { huddle: 30 * MIN, other: 10 * MIN, regular: 8 * H - 40 * MIN });
ok("...and the parts still add up to the total", withMeeting.regularSeconds + withMeeting.huddleSeconds + withMeeting.otherEligibleSeconds === withMeeting.productiveSeconds);
check("a live meeting with no huddle is 'other eligible'", base({ liveMeetings: [{ approvalStatus: "APPROVED", startedAt: at("15:00"), endedAt: at("15:30") }] }), { huddle: 0, other: 30 * MIN });
check("an unapproved live meeting counts for nothing", base({ liveMeetings: [{ approvalStatus: "PENDING", startedAt: at("15:00"), endedAt: at("15:30") }] }), { other: 0 });
check("overlapping breaks are removed once, not twice", base({ breaks: [lunch, { startedAt: at("13:30"), endedAt: at("14:30") }] }), { productive: 7.5 * H });

console.log("\n## forgot to press End Participation (a defined rule, the record stays open for the manager)");
const forgot = check("never ended, long after the expected end: counted only up to the expected end", base({ huddles: [huddle("a", "09:30", null, "10:00")], now: at("17:00") }), { huddle: 30 * MIN });
ok("...and flagged as open past its end", forgot.huddles[0].openPastEnd === true, forgot.huddles);
const live = check("still in the huddle within its scheduled time: counted up to now", base({ logoutAt: null, huddles: [huddle("a", "09:30", null, "10:00")], now: at("09:50") }), { huddle: 20 * MIN });
ok("...not flagged yet", live.huddles[0].openPastEnd === false);
check("an employee who ended after the expected end is counted to when they really ended", base({ huddles: [huddle("a", "09:30", "10:20", "10:00")] }), { huddle: 50 * MIN });
check("joined after the expected end and never ended: zero (the cap is behind the join)", base({ huddles: [huddle("a", "10:40", null, "10:00")], now: at("12:00") }), { huddle: 0 });
check("a zero-length record counts zero", base({ huddles: [huddle("a", "09:30", "09:30", "10:00")] }), { huddle: 0 });

console.log("\n## a day still in progress");
check("still clocked in: the total runs to now", base({ logoutAt: null, now: at("12:00"), breaks: [], huddles: [huddle("a", "09:30", "10:00", "10:00")] }), { huddle: 30 * MIN, productive: 3 * H, regular: 2.5 * H });

console.log("\n## the invariant, on every case above");
let allSum = true, noNeg = true;
for (const [name, input] of Object.entries(cases)) {
  const r = computeBreakdown(input);
  if (r.regularSeconds + r.huddleSeconds + r.otherEligibleSeconds !== r.productiveSeconds) { allSum = false; console.log("  sum broken:", name, r); }
  if (r.regularSeconds < 0 || r.huddleSeconds < 0 || r.otherEligibleSeconds < 0) noNeg = false;
}
ok("regular + huddle + other equals the productive total in every case", allSum);
ok("no part is ever negative", noNeg);
ok("a huddle can never make the total bigger than clocked-in time minus breaks", Object.values(cases).every((i) => computeBreakdown(i).productiveSeconds <= ((i.logoutAt ?? i.now).getTime() - i.loginAt.getTime()) / 1000));

console.log("\n## the interval helpers");
ok("merge joins overlapping and touching intervals and drops empty ones", JSON.stringify(merge([{ start: 5, end: 9 }, { start: 1, end: 3 }, { start: 3, end: 4 }, { start: 8, end: 12 }, { start: 20, end: 20 }])) === JSON.stringify([{ start: 1, end: 4 }, { start: 5, end: 12 }]));
ok("intersect keeps only what is in both", JSON.stringify(intersect([{ start: 0, end: 10 }], [{ start: 5, end: 20 }, { start: 30, end: 40 }])) === JSON.stringify([{ start: 5, end: 10 }]));
ok("intersect of disjoint intervals is empty", intersect([{ start: 0, end: 5 }], [{ start: 5, end: 9 }]).length === 0);
ok("subtract takes the middle out and leaves two parts", JSON.stringify(subtract([{ start: 0, end: 10 }], [{ start: 3, end: 6 }])) === JSON.stringify([{ start: 0, end: 3 }, { start: 6, end: 10 }]));
ok("subtract of everything leaves nothing", subtract([{ start: 2, end: 5 }], [{ start: 0, end: 9 }]).length === 0);
ok("totalSeconds floors to whole seconds", totalSeconds([{ start: 0, end: 1999 }]) === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
