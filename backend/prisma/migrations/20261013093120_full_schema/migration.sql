-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('EMPLOYEE', 'MANAGER', 'HR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('CANDIDATE', 'INVITED', 'ACTIVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('OFFER_SENT', 'OFFER_ACCEPTED', 'DOCUMENTS_PENDING', 'DOCUMENTS_SUBMITTED', 'AWAITING_RESUME', 'ACTIVE');

-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('SALES', 'SUPPORT', 'TECH', 'OPERATIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BreakType" AS ENUM ('TEA', 'LUNCH', 'WASHROOM', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('TEAM', 'CLIENT', 'ONE_ON_ONE', 'TRAINING', 'INTERVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskWeight" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LeaveDayType" AS ENUM ('PLANNED', 'SICK', 'COMP_OFF', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('WORKING', 'WEEKLY_OFF', 'PUBLIC_HOLIDAY', 'OPTIONAL_HOLIDAY');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('IDENTITY', 'EDUCATION', 'EMPLOYMENT', 'BANKING', 'PHOTO', 'RESUME', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InductionCategory" AS ENUM ('COMPANY_OVERVIEW', 'PROBATION_POLICY', 'LEAVE_POLICY', 'CODE_OF_CONDUCT', 'IT_POLICY', 'ROLE_TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('HR_QUERY', 'TECH_ISSUE', 'ADMIN_REQUEST', 'ATTENDANCE_CORRECTION');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('LATE_LOGIN', 'BREAK_OVERAGE', 'OVERTIME', 'NO_LOGIN', 'LOW_PRODUCTIVITY', 'MEETING_PENDING_APPROVAL', 'BIOMETRIC_MISMATCH');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "BiometricImportStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PunchMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS');

-- AlterTable
ALTER TABLE "platforms" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "defaultBreakBudgetMins" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "defaultDailyWorkHours" DOUBLE PRECISION NOT NULL DEFAULT 9,
ADD COLUMN     "defaultProductiveHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "senderEmail" TEXT;

-- CreateTable
CREATE TABLE "biometric_imports" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileHash" TEXT NOT NULL,
    "columnMap" JSONB,
    "periodFrom" DATE,
    "periodTo" DATE,
    "status" "BiometricImportStatus" NOT NULL DEFAULT 'PENDING',
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsMatched" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "biometric_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_punches" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "rawIdentifier" TEXT NOT NULL,
    "rawRow" JSONB,
    "userId" UUID,
    "matchStatus" "PunchMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "date" DATE NOT NULL,
    "firstIn" TIMESTAMP(3),
    "lastOut" TIMESTAMP(3),
    "inDeltaMinutes" INTEGER,
    "outDeltaMinutes" INTEGER,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biometric_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "employeeCode" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
    "status" "UserStatus" NOT NULL DEFAULT 'CANDIDATE',
    "designation" TEXT,
    "dateOfJoining" TIMESTAMP(3),
    "probationEndDate" TIMESTAMP(3),
    "exitDate" TIMESTAMP(3),
    "biometricId" TEXT,
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'OFFER_SENT',
    "trackerAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
    "accessGrantedAt" TIMESTAMP(3),
    "shiftId" UUID,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "teamType" "TeamType" NOT NULL DEFAULT 'OTHER',
    "managerId" UUID,
    "shiftId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_configs" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "dailyWorkHours" DOUBLE PRECISION NOT NULL DEFAULT 9,
    "productiveHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "breakBudgetMinutes" INTEGER NOT NULL DEFAULT 60,
    "lateLoginGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "breakOverageAlertMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeAlertMinutes" INTEGER NOT NULL DEFAULT 15,
    "lowProductivityThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "biometricToleranceMinutes" INTEGER NOT NULL DEFAULT 10,
    "notifyByEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifyByWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "eodReportTime" TEXT NOT NULL DEFAULT '19:30',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "spansMidnight" BOOLEAN NOT NULL DEFAULT false,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "dayType" "DayType" NOT NULL DEFAULT 'PUBLIC_HOLIDAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_templates" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "emailIntro" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "templateId" UUID,
    "roleTitle" TEXT NOT NULL,
    "joiningDate" DATE NOT NULL,
    "ctcAnnual" DECIMAL(12,2),
    "reportingTo" TEXT,
    "renderedHtml" TEXT NOT NULL,
    "pdfStorageKey" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "responseIp" TEXT,
    "declineReason" TEXT,
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requirements" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "category" "DocumentCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedByEmployee" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requirementId" UUID,
    "category" "DocumentCategory" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'REQUESTED',
    "storageKey" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "uploadedById" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "consentAcceptedAt" TIMESTAMP(3),
    "retentionUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "induction_documents" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "category" "InductionCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "teamId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "induction_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "induction_acknowledgements" (
    "id" UUID NOT NULL,
    "inductionDocumentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "induction_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "raisedById" UUID NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assignedToId" UUID,
    "dueAt" TIMESTAMP(3),
    "firstReplyAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "correctionDate" DATE,
    "requestedLoginAt" TIMESTAMP(3),
    "requestedLogoutAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "attachmentKey" TEXT,
    "attachmentName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "loginAt" TIMESTAMP(3) NOT NULL,
    "logoutAt" TIMESTAMP(3),
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "productiveSeconds" INTEGER NOT NULL DEFAULT 0,
    "breakSeconds" INTEGER NOT NULL DEFAULT 0,
    "meetingSeconds" INTEGER NOT NULL DEFAULT 0,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "autoClosedAt" TIMESTAMP(3),
    "shiftStartTime" TEXT,
    "wasLateLogin" BOOLEAN NOT NULL DEFAULT false,
    "lateByMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracker_breaks" (
    "id" UUID NOT NULL,
    "workSessionId" UUID NOT NULL,
    "breakType" "BreakType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracker_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracker_meetings" (
    "id" UUID NOT NULL,
    "workSessionId" UUID NOT NULL,
    "meetingType" "MeetingType" NOT NULL,
    "title" TEXT,
    "attendeeIds" UUID[],
    "approvalStatus" "MeetingApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "rejectionReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracker_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_tasks" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weight" "TaskWeight" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "carriedFromDate" DATE,
    "carryCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_days" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "leaveType" "LeaveDayType" NOT NULL DEFAULT 'PLANNED',
    "isHalfDay" BOOLEAN NOT NULL DEFAULT false,
    "isFirstHalf" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "markedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "platformId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "alertType" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "date" DATE NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "biometric_imports_platformId_status_idx" ON "biometric_imports"("platformId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_imports_platformId_fileHash_key" ON "biometric_imports"("platformId", "fileHash");

-- CreateIndex
CREATE INDEX "biometric_punches_platformId_date_idx" ON "biometric_punches"("platformId", "date");

-- CreateIndex
CREATE INDEX "biometric_punches_importId_idx" ON "biometric_punches"("importId");

-- CreateIndex
CREATE INDEX "biometric_punches_isFlagged_idx" ON "biometric_punches"("isFlagged");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_punches_userId_date_key" ON "biometric_punches"("userId", "date");

-- CreateIndex
CREATE INDEX "users_platformId_role_idx" ON "users"("platformId", "role");

-- CreateIndex
CREATE INDEX "users_platformId_status_idx" ON "users"("platformId", "status");

-- CreateIndex
CREATE INDEX "users_biometricId_idx" ON "users"("biometricId");

-- CreateIndex
CREATE UNIQUE INDEX "users_platformId_email_key" ON "users"("platformId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "users_platformId_employeeCode_key" ON "users"("platformId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");

-- CreateIndex
CREATE INDEX "password_resets_userId_idx" ON "password_resets"("userId");

-- CreateIndex
CREATE INDEX "teams_platformId_idx" ON "teams"("platformId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_platformId_name_key" ON "teams"("platformId", "name");

-- CreateIndex
CREATE INDEX "team_members_userId_isActive_idx" ON "team_members"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_configs_teamId_key" ON "team_configs"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_platformId_name_key" ON "shifts"("platformId", "name");

-- CreateIndex
CREATE INDEX "holidays_platformId_date_idx" ON "holidays"("platformId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_platformId_date_name_key" ON "holidays"("platformId", "date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "offer_templates_platformId_name_key" ON "offer_templates"("platformId", "name");

-- CreateIndex
CREATE INDEX "offers_platformId_status_idx" ON "offers"("platformId", "status");

-- CreateIndex
CREATE INDEX "offers_candidateId_idx" ON "offers"("candidateId");

-- CreateIndex
CREATE INDEX "document_requirements_platformId_isActive_idx" ON "document_requirements"("platformId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "document_requirements_platformId_label_key" ON "document_requirements"("platformId", "label");

-- CreateIndex
CREATE INDEX "employee_documents_userId_category_idx" ON "employee_documents"("userId", "category");

-- CreateIndex
CREATE INDEX "employee_documents_platformId_status_idx" ON "employee_documents"("platformId", "status");

-- CreateIndex
CREATE INDEX "induction_documents_platformId_isActive_idx" ON "induction_documents"("platformId", "isActive");

-- CreateIndex
CREATE INDEX "induction_acknowledgements_userId_idx" ON "induction_acknowledgements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "induction_acknowledgements_inductionDocumentId_userId_docum_key" ON "induction_acknowledgements"("inductionDocumentId", "userId", "documentVersion");

-- CreateIndex
CREATE INDEX "tickets_platformId_status_idx" ON "tickets"("platformId", "status");

-- CreateIndex
CREATE INDEX "tickets_assignedToId_status_idx" ON "tickets"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "tickets_raisedById_idx" ON "tickets"("raisedById");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_platformId_reference_key" ON "tickets"("platformId", "reference");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_idx" ON "ticket_messages"("ticketId");

-- CreateIndex
CREATE INDEX "work_sessions_platformId_date_idx" ON "work_sessions"("platformId", "date");

-- CreateIndex
CREATE INDEX "work_sessions_platformId_status_idx" ON "work_sessions"("platformId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_sessions_userId_date_key" ON "work_sessions"("userId", "date");

-- CreateIndex
CREATE INDEX "tracker_breaks_workSessionId_idx" ON "tracker_breaks"("workSessionId");

-- CreateIndex
CREATE INDEX "tracker_meetings_workSessionId_idx" ON "tracker_meetings"("workSessionId");

-- CreateIndex
CREATE INDEX "tracker_meetings_approvalStatus_idx" ON "tracker_meetings"("approvalStatus");

-- CreateIndex
CREATE INDEX "daily_tasks_userId_date_idx" ON "daily_tasks"("userId", "date");

-- CreateIndex
CREATE INDEX "daily_tasks_platformId_date_idx" ON "daily_tasks"("platformId", "date");

-- CreateIndex
CREATE INDEX "daily_tasks_userId_status_idx" ON "daily_tasks"("userId", "status");

-- CreateIndex
CREATE INDEX "leave_days_platformId_date_idx" ON "leave_days"("platformId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_days_userId_date_key" ON "leave_days"("userId", "date");

-- CreateIndex
CREATE INDEX "alerts_platformId_date_idx" ON "alerts"("platformId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_userId_date_alertType_key" ON "alerts"("userId", "date", "alertType");

-- AddForeignKey
ALTER TABLE "biometric_imports" ADD CONSTRAINT "biometric_imports_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_imports" ADD CONSTRAINT "biometric_imports_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_importId_fkey" FOREIGN KEY ("importId") REFERENCES "biometric_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_punches" ADD CONSTRAINT "biometric_punches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_configs" ADD CONSTRAINT "team_configs_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "offer_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "document_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "induction_documents" ADD CONSTRAINT "induction_documents_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "induction_acknowledgements" ADD CONSTRAINT "induction_acknowledgements_inductionDocumentId_fkey" FOREIGN KEY ("inductionDocumentId") REFERENCES "induction_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "induction_acknowledgements" ADD CONSTRAINT "induction_acknowledgements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_breaks" ADD CONSTRAINT "tracker_breaks_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_meetings" ADD CONSTRAINT "tracker_meetings_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracker_meetings" ADD CONSTRAINT "tracker_meetings_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_days" ADD CONSTRAINT "leave_days_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
