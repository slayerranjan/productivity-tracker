// ===========================================================================
// OWNER ACCESS
//
// Lives in lib, not in the admin module, because both admin and onboarding
// need it. Putting it in admin.service made onboarding import admin while
// admin already imported onboarding - a cycle TypeScript compiles happily
// and Node then fails on at runtime.
//
// Ranjan runs all ten companies and needs to see across them; a customer's
// admin must not. OWNER_CODES in .env decides. A customer never sets it, so
// their admin stays scoped exactly as before.
// ===========================================================================

import { prisma } from "./prisma.js";
import { getPinnedCompany } from "./deployment.js";

export async function viewerIsOwner(viewerId: string): Promise<boolean> {
  const codes = String(process.env.OWNER_CODES ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.length === 0) return false;

  const me = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { employeeCode: true },
  });
  return codes.includes(String(me?.employeeCode ?? "").toUpperCase());
}
