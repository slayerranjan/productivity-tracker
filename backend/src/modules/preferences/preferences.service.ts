import { prisma } from "../../lib/prisma.js";
import { auditNote } from "../../lib/auditContext.js";

// ---------------------------------------------------------------------------
// PREFERENCES: a person's own display choices. Only ever their own row (the id comes from the sign-in, never from the
// request). Safe before the migration: if the table is not there, reads say "not ready" and the screen keeps the
// choice in the browser instead; a write is refused with FEATURES_NOT_READY.
// ---------------------------------------------------------------------------

export const THEMES = ["LIGHT", "DARK"] as const;
export type Theme = (typeof THEMES)[number];

const isMissingTable = (e: unknown) => {
  const code = (e as { code?: unknown })?.code;
  const msg = e instanceof Error ? e.message : "";
  return code === "P2021" || (/user_preferences/.test(msg) && /does not exist|relation/.test(msg));
};

let readyValue = false;
let readyCheckedAt = 0;
async function ready(): Promise<boolean> {
  if (readyValue) return true;
  if (Date.now() - readyCheckedAt < 15_000) return false;
  readyCheckedAt = Date.now();
  try {
    await prisma.userPreference.findFirst({ select: { userId: true } });
    readyValue = true;
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    readyValue = false;
  }
  return readyValue;
}

/** theme is null when the person has never chosen (shown as light). ready=false: the table does not exist yet. */
export async function get(userId: string): Promise<{ ready: boolean; theme: Theme | null }> {
  if (!(await ready())) return { ready: false, theme: null };
  const row = await prisma.userPreference.findUnique({ where: { userId }, select: { theme: true } });
  const t = row?.theme;
  return { ready: true, theme: t === "DARK" || t === "LIGHT" ? t : null };
}

export async function setTheme(userId: string, raw: unknown): Promise<{ ready: true; theme: Theme }> {
  const theme = THEMES.find((t) => t === raw);
  if (!theme) throw new Error("BAD_THEME");
  if (!(await ready())) throw new Error("FEATURES_NOT_READY");
  try {
    await prisma.userPreference.upsert({ where: { userId }, update: { theme }, create: { userId, theme } });
  } catch (e) {
    if (isMissingTable(e)) throw new Error("FEATURES_NOT_READY");
    throw e;
  }
  auditNote({ recordType: "Preference", recordId: userId, summary: `Chose the ${theme.toLowerCase()} theme`, after: { theme } });
  return { ready: true, theme };
}
