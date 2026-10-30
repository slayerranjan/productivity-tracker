-- Employment type (optional) per employee, and "applies to" per document requirement.
-- New tables only: no existing table is changed. No rows = "everyone" / "unspecified", exactly as today.

CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'PROBATION', 'CONTRACT', 'INTERN');

CREATE TABLE "employee_profiles" (
  "userId" UUID NOT NULL,
  "employmentType" "EmploymentType" NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "document_requirement_scopes" (
  "requirementId" UUID NOT NULL,
  "employmentType" "EmploymentType" NOT NULL,
  CONSTRAINT "document_requirement_scopes_pkey" PRIMARY KEY ("requirementId", "employmentType")
);
ALTER TABLE "document_requirement_scopes" ADD CONSTRAINT "document_requirement_scopes_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "document_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
