-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'ONBOARDING_OVERDUE';

-- AlterTable
ALTER TABLE "team_configs" ADD COLUMN     "onboardingSlaHours" INTEGER NOT NULL DEFAULT 48;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "documentsSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "salary_slips" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "grossAmount" DECIMAL(12,2),
    "deductions" DECIMAL(12,2),
    "netAmount" DECIMAL(12,2),
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedById" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_slips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_slips_platformId_year_month_idx" ON "salary_slips"("platformId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "salary_slips_userId_year_month_key" ON "salary_slips"("userId", "year", "month");

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_slips" ADD CONSTRAINT "salary_slips_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
