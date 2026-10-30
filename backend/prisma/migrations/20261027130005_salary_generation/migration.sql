-- AlterTable
ALTER TABLE "platforms" ADD COLUMN     "monthlySalary" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "salary_slips" ADD COLUMN     "absentDays" DECIMAL(5,2),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "daysInMonth" INTEGER,
ADD COLUMN     "generatedAt" TIMESTAMP(3),
ADD COLUMN     "lossOfPay" DECIMAL(12,2),
ADD COLUMN     "otherDeduction" DECIMAL(12,2),
ADD COLUMN     "otherDeductionNote" TEXT,
ADD COLUMN     "payableDays" DECIMAL(5,2),
ADD COLUMN     "perDayRate" DECIMAL(10,2),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ALTER COLUMN "storageKey" DROP NOT NULL,
ALTER COLUMN "fileName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "team_configs" ADD COLUMN     "fullDayAfterHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
ADD COLUMN     "halfDayAfterHours" DOUBLE PRECISION NOT NULL DEFAULT 4;
