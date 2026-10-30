-- Daily task targets (tasks a person is expected to finish per day). New table only; nothing existing changes.
-- One row per scope: company default (teamId and userId empty), a team, or a person.

CREATE TABLE "daily_task_targets" (
  "id" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "teamId" UUID,
  "userId" UUID,
  "tasksPerDay" INTEGER NOT NULL,
  "updatedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_task_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_task_targets_positive" CHECK ("tasksPerDay" > 0 AND "tasksPerDay" <= 1000),
  CONSTRAINT "daily_task_targets_one_scope" CHECK (NOT ("teamId" IS NOT NULL AND "userId" IS NOT NULL))
);

CREATE INDEX "daily_task_targets_platformId_idx" ON "daily_task_targets"("platformId");

-- At most one target per scope (a plain UNIQUE would treat empty values as different).
CREATE UNIQUE INDEX "daily_task_targets_company_default" ON "daily_task_targets"("platformId") WHERE "teamId" IS NULL AND "userId" IS NULL;
CREATE UNIQUE INDEX "daily_task_targets_team_unique" ON "daily_task_targets"("platformId", "teamId") WHERE "teamId" IS NOT NULL;
CREATE UNIQUE INDEX "daily_task_targets_user_unique" ON "daily_task_targets"("platformId", "userId") WHERE "userId" IS NOT NULL;

ALTER TABLE "daily_task_targets" ADD CONSTRAINT "daily_task_targets_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_task_targets" ADD CONSTRAINT "daily_task_targets_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_task_targets" ADD CONSTRAINT "daily_task_targets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_task_targets" ADD CONSTRAINT "daily_task_targets_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
