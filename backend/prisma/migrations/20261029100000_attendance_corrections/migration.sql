-- Attendance correction requests, their audit trail, and a generic in-app notification inbox.
-- Additive only: no existing table is changed.

CREATE TYPE "CorrectionType" AS ENUM ('MISSING_CHECKIN', 'MISSING_CHECKOUT', 'INCORRECT_TIME', 'BIOMETRIC_FAILURE', 'FORGOT_CLOCK_IN', 'OTHER');
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "attendance_correction_requests" (
  "id" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "workSessionId" UUID,
  "date" DATE NOT NULL,
  "correctionType" "CorrectionType" NOT NULL,
  "originalLoginAt" TIMESTAMP(3),
  "originalLogoutAt" TIMESTAMP(3),
  "requestedLoginAt" TIMESTAMP(3),
  "requestedLogoutAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "attachmentKey" TEXT,
  "attachmentName" TEXT,
  "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  "reviewComment" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_correction_requests_platformId_status_createdAt_idx" ON "attendance_correction_requests"("platformId", "status", "createdAt");
CREATE INDEX "attendance_correction_requests_userId_date_idx" ON "attendance_correction_requests"("userId", "date");
-- The database itself refuses a second PENDING request for the same person and day.
CREATE UNIQUE INDEX "attendance_correction_one_pending_per_day" ON "attendance_correction_requests"("userId", "date") WHERE "status" = 'PENDING';
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "attendance_correction_audits" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "workSessionId" UUID,
  "action" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "actedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_correction_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_correction_audits_requestId_idx" ON "attendance_correction_audits"("requestId");
CREATE INDEX "attendance_correction_audits_userId_createdAt_idx" ON "attendance_correction_audits"("userId", "createdAt");
ALTER TABLE "attendance_correction_audits" ADD CONSTRAINT "attendance_correction_audits_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "attendance_correction_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_audits" ADD CONSTRAINT "attendance_correction_audits_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "link" TEXT,
  "data" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
