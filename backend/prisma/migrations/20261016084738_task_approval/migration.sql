-- CreateEnum
CREATE TYPE "TaskApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaskOutcome" AS ENUM ('COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "daily_tasks" ADD COLUMN     "approvalStatus" "TaskApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "assignedById" UUID,
ADD COLUMN     "completionNote" TEXT,
ADD COLUMN     "outcome" "TaskOutcome",
ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
