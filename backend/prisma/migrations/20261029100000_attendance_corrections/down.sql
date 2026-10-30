-- UNDO for 20261029100000_attendance_corrections: removes the correction requests, their audit
-- history and the notification inbox (everything in them is lost). Attendance records themselves
-- are not touched.
DROP TABLE IF EXISTS "attendance_correction_audits";
DROP TABLE IF EXISTS "attendance_correction_requests";
DROP TABLE IF EXISTS "notifications";
DROP TYPE IF EXISTS "CorrectionStatus";
DROP TYPE IF EXISTS "CorrectionType";
