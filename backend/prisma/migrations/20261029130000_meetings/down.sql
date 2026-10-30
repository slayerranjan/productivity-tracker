-- UNDO for 20261029130000_meetings: removes the scheduled-meetings tables and everything in them.
DROP TABLE IF EXISTS "meeting_attendees";
DROP TABLE IF EXISTS "meetings";
DROP TYPE IF EXISTS "MeetingStatus";
