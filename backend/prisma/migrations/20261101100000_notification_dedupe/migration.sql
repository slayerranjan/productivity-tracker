-- Stops the same notification being created twice for one person.
-- An INDEX ONLY: no column is added to "notifications" and no row is touched. A notification that carries a
-- "dedupeKey" inside its data (for example "task:<id>:submitted:1") can exist once per person; notifications
-- without one (everything created before this, and by corrections/meetings/policies) are not affected at all.
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key"
  ON "notifications" ("userId", (("data" ->> 'dedupeKey')))
  WHERE ("data" ->> 'dedupeKey') IS NOT NULL;
