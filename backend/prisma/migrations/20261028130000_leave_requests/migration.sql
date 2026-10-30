-- Leave requests: employee asks, HR/Admin approves. Additive only.
ALTER TYPE "LeaveDayType" ADD VALUE IF NOT EXISTS 'CASUAL';
ALTER TYPE "LeaveDayType" ADD VALUE IF NOT EXISTS 'EARNED';

CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "leave_requests" (
  "id" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "fromDate" DATE NOT NULL,
  "toDate" DATE NOT NULL,
  "leaveType" "LeaveDayType" NOT NULL,
  "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
  "isFirstHalf" BOOLEAN NOT NULL DEFAULT true,
  "dayCount" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
  "decidedById" UUID,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leave_requests_platformId_status_idx" ON "leave_requests"("platformId", "status");
CREATE INDEX "leave_requests_userId_fromDate_idx" ON "leave_requests"("userId", "fromDate");
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_days" ADD COLUMN "leaveRequestId" UUID;
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
