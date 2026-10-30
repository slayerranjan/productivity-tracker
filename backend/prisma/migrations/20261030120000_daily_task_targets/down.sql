-- UNDO for 20261030120000_daily_task_targets: removes the daily task targets (the targets themselves are lost).
-- Tasks, completion times and attendance are not touched.
DROP TABLE IF EXISTS "daily_task_targets";
