-- Audit rows can never be edited or deleted, not even by the application or a mistaken script.
-- The ONLY change allowed is the database clearing a link to a deleted user or company
-- (the existing foreign keys are ON DELETE SET NULL), so removing a person never removes history.

CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs rows cannot be deleted';
  ELSIF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'audit_logs cannot be truncated';
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW."id", NEW."method", NEW."path", NEW."status", NEW."detail", NEW."ip", NEW."createdAt",
        NEW."module", NEW."action", NEW."recordType", NEW."recordId", NEW."targetUserId", NEW."summary", NEW."before", NEW."after")
       IS DISTINCT FROM
       (OLD."id", OLD."method", OLD."path", OLD."status", OLD."detail", OLD."ip", OLD."createdAt",
        OLD."module", OLD."action", OLD."recordType", OLD."recordId", OLD."targetUserId", OLD."summary", OLD."before", OLD."after")
    THEN
      RAISE EXCEPTION 'audit_logs rows cannot be edited';
    END IF;
    -- actorId / platformId may only be cleared (ON DELETE SET NULL), never pointed somewhere else.
    IF (NEW."actorId" IS NOT NULL AND NEW."actorId" IS DISTINCT FROM OLD."actorId")
       OR (NEW."platformId" IS NOT NULL AND NEW."platformId" IS DISTINCT FROM OLD."platformId") THEN
      RAISE EXCEPTION 'audit_logs rows cannot be edited';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_change
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_guard();
