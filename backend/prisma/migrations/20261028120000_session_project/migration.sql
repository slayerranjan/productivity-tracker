-- Optional project (team) chosen at clock-in. Nullable, so existing rows are untouched.
ALTER TABLE "work_sessions" ADD COLUMN IF NOT EXISTS "teamId" UUID;
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
