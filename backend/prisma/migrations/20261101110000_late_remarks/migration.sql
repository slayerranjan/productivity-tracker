-- Late remarks: the reason a person types when they clock in after the late cut-off.
-- A NEW table only. No column is added to any existing table and no existing row is touched.
CREATE TABLE "late_remarks" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "remark" TEXT NOT NULL,
    "lateByMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "late_remarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "late_remarks_sessionId_key" ON "late_remarks"("sessionId");
CREATE INDEX "late_remarks_platformId_createdAt_idx" ON "late_remarks"("platformId", "createdAt");
CREATE INDEX "late_remarks_userId_createdAt_idx" ON "late_remarks"("userId", "createdAt");

ALTER TABLE "late_remarks" ADD CONSTRAINT "late_remarks_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "late_remarks" ADD CONSTRAINT "late_remarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "late_remarks" ADD CONSTRAINT "late_remarks_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
