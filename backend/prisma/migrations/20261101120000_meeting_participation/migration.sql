-- In-person meeting participation (self-reported). NEW tables only: no column is added to any existing table and no
-- existing row is touched. Separate from attendance, working hours and productivity.
CREATE TABLE "meeting_tracking" (
    "meetingId" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "lateAfterMinutes" INTEGER NOT NULL DEFAULT 5,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_tracking_pkey" PRIMARY KEY ("meetingId"),
    CONSTRAINT "meeting_tracking_lateAfterMinutes_check" CHECK ("lateAfterMinutes" >= 0 AND "lateAfterMinutes" <= 120)
);
CREATE INDEX "meeting_tracking_platformId_idx" ON "meeting_tracking"("platformId");

CREATE TABLE "meeting_participation" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'SELF',
    "endedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_participation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meeting_participation_source_check" CHECK ("source" IN ('SELF', 'MANAGER_ADDED')),
    CONSTRAINT "meeting_participation_endedBy_check" CHECK ("endedBy" IS NULL OR "endedBy" IN ('SELF', 'MANAGER')),
    CONSTRAINT "meeting_participation_order_check" CHECK ("leftAt" IS NULL OR "leftAt" >= "joinedAt")
);
CREATE UNIQUE INDEX "meeting_participation_meetingId_userId_key" ON "meeting_participation"("meetingId", "userId");
CREATE INDEX "meeting_participation_meetingId_idx" ON "meeting_participation"("meetingId");
CREATE INDEX "meeting_participation_userId_joinedAt_idx" ON "meeting_participation"("userId", "joinedAt");

CREATE TABLE "meeting_participation_changes" (
    "id" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "actedById" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "beforeJoinedAt" TIMESTAMP(3),
    "beforeLeftAt" TIMESTAMP(3),
    "afterJoinedAt" TIMESTAMP(3),
    "afterLeftAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_participation_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meeting_participation_changes_action_check" CHECK ("action" IN ('ADD', 'EDIT'))
);
CREATE INDEX "meeting_participation_changes_meetingId_userId_idx" ON "meeting_participation_changes"("meetingId", "userId");

-- Foreign keys. Deleting a meeting or a person removes their participation; the correction history keeps the manager
-- (RESTRICT) so an accountable name can never silently disappear.
ALTER TABLE "meeting_tracking" ADD CONSTRAINT "meeting_tracking_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_tracking" ADD CONSTRAINT "meeting_tracking_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_tracking" ADD CONSTRAINT "meeting_tracking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meeting_participation" ADD CONSTRAINT "meeting_participation_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_participation" ADD CONSTRAINT "meeting_participation_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_participation" ADD CONSTRAINT "meeting_participation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "meeting_participation_changes" ADD CONSTRAINT "meeting_participation_changes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_participation_changes" ADD CONSTRAINT "meeting_participation_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_participation_changes" ADD CONSTRAINT "meeting_participation_changes_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
