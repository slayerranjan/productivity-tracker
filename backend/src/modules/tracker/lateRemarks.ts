import { prisma } from "../../lib/prisma.js";

// ---------------------------------------------------------------------------
// LATE REMARKS
// When someone clocks in after the late cut-off (the existing rule: shift start + the team's grace) they must
// give a short reason. It is stored beside the day's session in `late_remarks` (a new table).
//
// Safe before the migration: if the table does not exist yet nobody is asked for a remark and every read
// returns "no remark", so the app behaves exactly as it did.
// ---------------------------------------------------------------------------

export const REMARK_MIN = 3;
export const REMARK_MAX = 300;

/** Thrown at clock-in when a late person has not given a reason. The route turns it into a 409 the screen understands. */
export class LateRemarkRequired extends Error {
  constructor(public lateByMinutes: number) {
    super("LATE_REMARK_REQUIRED");
  }
}

const isMissingTable = (e: unknown) => {
  const code = (e as { code?: unknown })?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2021" || (/late_remarks/.test(msg) && /does not exist|relation/.test(msg));
};

let readyValue = false;
let readyCheckedAt = 0;
export async function lateRemarksReady(): Promise<boolean> {
  if (readyValue) return true;
  if (Date.now() - readyCheckedAt < 15_000) return false;
  readyCheckedAt = Date.now();
  try {
    await prisma.lateRemark.findFirst({ select: { id: true } });
    readyValue = true;
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    readyValue = false;
  }
  return readyValue;
}

/** Trim and tidy what the person typed. Returns null when there is nothing usable. */
export function cleanRemark(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < REMARK_MIN) return null;
  if (text.length > REMARK_MAX) throw new Error("LATE_REMARK_TOO_LONG");
  return text;
}

/** session id -> remark, for the days being shown. Empty when the table is not there yet. */
export async function remarksBySession(sessionIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (sessionIds.length === 0 || !(await lateRemarksReady())) return out;
  try {
    const rows = await prisma.lateRemark.findMany({ where: { sessionId: { in: sessionIds } }, select: { sessionId: true, remark: true } });
    for (const r of rows) out.set(r.sessionId, r.remark);
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  return out;
}
