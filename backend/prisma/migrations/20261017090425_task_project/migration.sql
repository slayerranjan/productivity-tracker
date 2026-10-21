-- AlterTable
ALTER TABLE "daily_tasks" ADD COLUMN     "teamId" UUID;

-- AlterTable
ALTER TABLE "team_members" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "daily_tasks_teamId_date_idx" ON "daily_tasks"("teamId", "date");

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
