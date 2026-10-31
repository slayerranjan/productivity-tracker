-- Per-person display preferences (light / dark theme). A NEW table only: no column is added to any existing table
-- and no existing row is touched.
CREATE TABLE "user_preferences" (
    "userId" UUID NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'LIGHT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "user_preferences_theme_check" CHECK ("theme" IN ('LIGHT', 'DARK'))
);

-- Deleting a person removes their preference with them.
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
