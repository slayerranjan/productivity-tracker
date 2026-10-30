-- Login usernames (an extra way to sign in). New table only; no existing table, column, password or ID changes.

CREATE TABLE "login_usernames" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "login_usernames_pkey" PRIMARY KEY ("id"),
  -- lower-case letters, digits and underscores; starts with a letter; no "@" (that would look like an email)
  CONSTRAINT "login_usernames_format" CHECK ("username" ~ '^[a-z][a-z0-9_]{2,40}$')
);

CREATE UNIQUE INDEX "login_usernames_userId_key" ON "login_usernames"("userId");
CREATE UNIQUE INDEX "login_usernames_username_key" ON "login_usernames"("username");

ALTER TABLE "login_usernames" ADD CONSTRAINT "login_usernames_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
