/*
  Warnings:

  - A unique constraint covering the columns `[employeeCode]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "platformId" UUID,
    "actorId" UUID,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "detail" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_platformId_createdAt_idx" ON "audit_logs"("platformId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeCode_key" ON "users"("employeeCode");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
