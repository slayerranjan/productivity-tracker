-- UNDO for 20261101140000_manager_self_tasks: removes only the two new tables (and the trigger function). Tasks are untouched;
-- a manager's own tasks simply go back to waiting for approval.
DROP TABLE IF EXISTS "task_events";
DROP TABLE IF EXISTS "task_self_details";
DROP FUNCTION IF EXISTS task_events_no_edit();
