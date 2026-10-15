-- AlterTable
ALTER TABLE "tracker_meetings" ADD COLUMN     "invitedById" UUID;

-- AddForeignKey
ALTER TABLE "tracker_meetings" ADD CONSTRAINT "tracker_meetings_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
