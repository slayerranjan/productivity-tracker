-- Manager self-managed tasks: NEW tables only. No column is added to daily_tasks and no existing row is touched.
CREATE TABLE "task_self_details" (
    "taskId" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3),
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "task_self_details_pkey" PRIMARY KEY ("taskId")
);
CREATE INDEX "task_self_details_userId_idx" ON "task_self_details"("userId");
CREATE INDEX "task_self_details_platformId_dueDate_idx" ON "task_self_details"("platformId", "dueDate");

CREATE TABLE "task_events" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_events_kind_check" CHECK ("kind" IN ('CREATED', 'STARTED', 'COMPLETED', 'REOPENED', 'EDITED', 'UPDATE'))
);
CREATE INDEX "task_events_taskId_createdAt_idx" ON "task_events"("taskId", "createdAt");

-- Deleting the task (or the company/person) removes its self-managed details and its history with it.
ALTER TABLE "task_self_details" ADD CONSTRAINT "task_self_details_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "daily_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_self_details" ADD CONSTRAINT "task_self_details_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_self_details" ADD CONSTRAINT "task_self_details_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "daily_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The history can be added to but never rewritten or removed by a normal update (the CASCADE above only fires when the task itself is deleted).
CREATE OR REPLACE FUNCTION task_events_no_edit() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'task history rows cannot be changed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER task_events_no_update BEFORE UPDATE ON "task_events" FOR EACH ROW EXECUTE FUNCTION task_events_no_edit();
