-- Scheduled meetings with a pasted link, and their attendees. New tables only.

CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

CREATE TABLE "meetings" (
  "id" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "organizerId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "meetingUrl" TEXT,
  "provider" TEXT,
  "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meetings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meetings_end_after_start" CHECK ("endsAt" > "startsAt")
);
CREATE INDEX "meetings_platformId_startsAt_idx" ON "meetings"("platformId", "startsAt");
CREATE INDEX "meetings_organizerId_startsAt_idx" ON "meetings"("organizerId", "startsAt");
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "meeting_attendees" (
  "id" UUID NOT NULL,
  "meetingId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meeting_attendees_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "meeting_attendees_meetingId_userId_key" ON "meeting_attendees"("meetingId", "userId");
CREATE INDEX "meeting_attendees_userId_idx" ON "meeting_attendees"("userId");
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
