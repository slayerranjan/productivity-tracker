import "dotenv/config";
import { prisma } from "./prisma.js";

// ---------------------------------------------------------------------------
// DEPLOYMENT PIN
//
// The database can hold many companies. A deployment can be pinned to ONE of
// them with HRMS_COMPANY_SLUG in .env (for example "avatar-india"). While it
// is set:
//   - only people who belong to that company can sign in or use the API,
//   - owner / admin reach across companies is switched off,
//   - every list, count and report therefore sees that company only.
// Other companies and their rows stay in the database, untouched. Remove the
// setting and the application behaves exactly as before.
// ---------------------------------------------------------------------------

export type PinnedCompany = { id: string; name: string; slug: string };

let cache: { slug: string; company: PinnedCompany; at: number } | null = null;
const TTL_MS = 60_000;

export const pinnedSlug = () => String(process.env.HRMS_COMPANY_SLUG ?? "").trim().toLowerCase() || null;

// null = not pinned. Throws PINNED_COMPANY_MISSING if the slug matches nothing,
// so a typo in .env locks everyone out loudly instead of silently showing all companies.
export async function getPinnedCompany(): Promise<PinnedCompany | null> {
  const slug = pinnedSlug();
  if (!slug) return null;
  if (cache && cache.slug === slug && Date.now() - cache.at < TTL_MS) return cache.company;
  const row = await prisma.platform.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!row) throw new Error("PINNED_COMPANY_MISSING");
  cache = { slug, company: row, at: Date.now() };
  return row;
}

// Cross-company links exist on purpose (one manager can run people in several
// companies). A pinned deployment must not follow them out of its company, so
// every "people this manager can see" list is passed through here.
export async function onlyPinnedCompany(ids: string[]): Promise<string[]> {
  const pinned = await getPinnedCompany();
  if (!pinned || ids.length === 0) return ids;
  const keep = await prisma.user.findMany({ where: { id: { in: ids }, platformId: pinned.id }, select: { id: true } });
  const ok = new Set(keep.map((u) => u.id));
  return ids.filter((id) => ok.has(id));
}

// For a single person: true when this deployment may touch them.
export async function inPinnedCompany(userId: string): Promise<boolean> {
  const pinned = await getPinnedCompany();
  if (!pinned) return true;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { platformId: true } });
  return u?.platformId === pinned.id;
}
