-- Policy management: drafts, publishing, categories, audience, versions, HR review notes.
-- NEW TABLES ONLY. No existing table or column changes. induction_documents / induction_acknowledgements are reused as they are.

CREATE TABLE "policy_details" (
  "policyId" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "effectiveDate" DATE,
  "publishedAt" TIMESTAMP(3),
  "allowDownload" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "policy_details_pkey" PRIMARY KEY ("policyId"),
  CONSTRAINT "policy_details_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED'))
);
CREATE INDEX "policy_details_platformId_status_idx" ON "policy_details"("platformId", "status");
ALTER TABLE "policy_details" ADD CONSTRAINT "policy_details_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "induction_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_details" ADD CONSTRAINT "policy_details_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_details" ADD CONSTRAINT "policy_details_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "policy_versions" (
  "id" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER,
  "mimeType" TEXT,
  "changeNote" TEXT,
  "requiresAck" BOOLEAN NOT NULL DEFAULT true,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedById" UUID,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_versions_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  CONSTRAINT "policy_versions_number_positive" CHECK ("number" > 0)
);
CREATE UNIQUE INDEX "policy_versions_policyId_number_key" ON "policy_versions"("policyId", "number");
CREATE INDEX "policy_versions_policyId_status_idx" ON "policy_versions"("policyId", "status");
-- At most one unpublished draft per policy, and at most one live version.
CREATE UNIQUE INDEX "policy_versions_one_draft" ON "policy_versions"("policyId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "policy_versions_one_published" ON "policy_versions"("policyId") WHERE "status" = 'PUBLISHED';
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "induction_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "policy_audience" (
  "id" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  CONSTRAINT "policy_audience_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_audience_kind_check" CHECK ("kind" IN ('TEAM', 'EMPLOYMENT_TYPE', 'ROLE'))
);
CREATE UNIQUE INDEX "policy_audience_policyId_kind_value_key" ON "policy_audience"("policyId", "kind", "value");
ALTER TABLE "policy_audience" ADD CONSTRAINT "policy_audience_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "induction_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "policy_categories" (
  "id" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_categories_name_length" CHECK (char_length("name") BETWEEN 2 AND 60)
);
CREATE UNIQUE INDEX "policy_categories_platformId_name_key" ON "policy_categories"("platformId", "name");
ALTER TABLE "policy_categories" ADD CONSTRAINT "policy_categories_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_categories" ADD CONSTRAINT "policy_categories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "policy_review_notes" (
  "id" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "platformId" UUID NOT NULL,
  "versionId" UUID,
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMP(3),
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "policy_review_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "policy_review_notes_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED', 'DISMISSED'))
);
CREATE INDEX "policy_review_notes_policyId_status_idx" ON "policy_review_notes"("policyId", "status");
ALTER TABLE "policy_review_notes" ADD CONSTRAINT "policy_review_notes_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "induction_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_review_notes" ADD CONSTRAINT "policy_review_notes_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "policy_review_notes" ADD CONSTRAINT "policy_review_notes_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
