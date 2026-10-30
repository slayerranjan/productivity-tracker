-- Audit log: structured columns so the screen can filter by module, action and employee,
-- and show the original and new values. Additive only: existing columns and rows are untouched.
-- Rows written before this migration are classified when read (and may be backfilled once with
-- backend/scripts/backfill-audit.ts BEFORE the immutability migration is applied).

ALTER TABLE "audit_logs"
  ADD COLUMN "module" TEXT,
  ADD COLUMN "action" TEXT,
  ADD COLUMN "recordType" TEXT,
  ADD COLUMN "recordId" TEXT,
  ADD COLUMN "targetUserId" UUID,
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "before" JSONB,
  ADD COLUMN "after" JSONB;

CREATE INDEX "audit_logs_platformId_module_createdAt_idx" ON "audit_logs"("platformId", "module", "createdAt");
CREATE INDEX "audit_logs_platformId_targetUserId_createdAt_idx" ON "audit_logs"("platformId", "targetUserId", "createdAt");
