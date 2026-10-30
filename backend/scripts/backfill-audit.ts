// One-off: classify audit rows written before the structured columns existed.
//
//   npx tsx scripts/backfill-audit.ts           dry run: counts only, writes nothing
//   npx tsx scripts/backfill-audit.ts --apply   fills module/action/summary/recordType/recordId/targetUserId
//
// It ONLY fills the new empty columns (where module IS NULL). It never changes method, path, detail,
// status, ip, time or actor. Run it AFTER migration 20261029110000_audit_log_structured and BEFORE
// 20261029111000_audit_log_immutable (after that, rows can no longer be updated at all).
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { classify } from "../src/lib/auditCatalog.js";

const apply = process.argv.includes("--apply");
const host = new URL(String(process.env.DIRECT_URL ?? process.env.DATABASE_URL)).host;
console.log(`database: ${host.slice(0, 24)}...  mode: ${apply ? "APPLY" : "dry run"}`);

const rows = await prisma.auditLog.findMany({ where: { module: null }, select: { id: true, method: true, path: true, detail: true } });
console.log(`rows without a module: ${rows.length}`);

let done = 0;
const byModule: Record<string, number> = {};
for (const r of rows) {
  const c = classify(r.method, r.path, (r.detail ?? {}) as Record<string, unknown>);
  byModule[c.module] = (byModule[c.module] ?? 0) + 1;
  if (!apply) continue;
  await prisma.auditLog.update({
    where: { id: r.id },
    data: { module: c.module, action: c.action, summary: c.summary, recordType: c.recordType, recordId: c.recordId, targetUserId: c.targetUserId },
    select: { id: true },
  });
  done++;
}
console.log("by module:", byModule);
console.log(apply ? `updated ${done} rows` : "nothing written (add --apply to write)");
await prisma.$disconnect();
