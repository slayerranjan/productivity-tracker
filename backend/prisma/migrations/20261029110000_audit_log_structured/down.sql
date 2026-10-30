-- UNDO for 20261029110000_audit_log_structured (run only if the immutability migration is NOT applied,
-- or after running its own down.sql first). Dropping the columns discards the structured data.
DROP INDEX IF EXISTS "audit_logs_platformId_targetUserId_createdAt_idx";
DROP INDEX IF EXISTS "audit_logs_platformId_module_createdAt_idx";
ALTER TABLE "audit_logs"
  DROP COLUMN IF EXISTS "after",
  DROP COLUMN IF EXISTS "before",
  DROP COLUMN IF EXISTS "summary",
  DROP COLUMN IF EXISTS "targetUserId",
  DROP COLUMN IF EXISTS "recordId",
  DROP COLUMN IF EXISTS "recordType",
  DROP COLUMN IF EXISTS "action",
  DROP COLUMN IF EXISTS "module";
