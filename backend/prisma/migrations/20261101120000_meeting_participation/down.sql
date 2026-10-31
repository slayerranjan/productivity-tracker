-- UNDO for 20261101120000_meeting_participation: removes only the three participation tables. Meetings, invitees,
-- attendance and everything else are untouched.
DROP TABLE IF EXISTS "meeting_participation_changes";
DROP TABLE IF EXISTS "meeting_participation";
DROP TABLE IF EXISTS "meeting_tracking";
