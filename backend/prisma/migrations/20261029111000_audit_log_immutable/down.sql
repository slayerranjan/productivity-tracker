-- UNDO for 20261029111000_audit_log_immutable: makes audit rows editable again.
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON "audit_logs";
DROP TRIGGER IF EXISTS audit_logs_no_change ON "audit_logs";
DROP FUNCTION IF EXISTS audit_logs_guard();
