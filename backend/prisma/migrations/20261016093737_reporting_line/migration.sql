-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reportsToId" UUID;

-- CreateIndex
CREATE INDEX "users_reportsToId_idx" ON "users"("reportsToId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
