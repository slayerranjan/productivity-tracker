-- UNDO for 20261101100000_notification_dedupe: removes the duplicate guard. No notification is touched.
DROP INDEX IF EXISTS "notifications_userId_dedupeKey_key";
