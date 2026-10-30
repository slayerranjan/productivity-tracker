# Backend tests

These scripts call the running backend over HTTP and also read/write the database
directly to check results. **They create and delete data.** They must only run
against a disposable Neon *branch*, never the database in `backend/.env`.
`_guard.cjs` refuses to run if the target is the same database as `backend/.env`.

## Run

1. Create a Neon branch of your database (Neon console) and copy its connection string.
2. Start the backend against that branch, on port 5002, with email switched off:

   ```powershell
   cd backend
   $env:DATABASE_URL = "<branch url>"; $env:DIRECT_URL = "<branch url>"
   $env:PORT = "5002"; $env:SMTP_HOST = ""; $env:SMTP_USER = ""; $env:SMTP_PASS = ""
   npx tsx src/server.ts
   ```
3. In another terminal:

   ```powershell
   cd backend
   $env:TEST_DATABASE_URL = "<branch url>"
   # Passwords of the seeded users on the TEST branch (see prisma/seed.ts). Never the live passwords.
   $env:TEST_PW_ADMIN = "..."; $env:TEST_PW_MANAGER = "..."; $env:TEST_PW_EMPLOYEE = "..."
   node tests/api-suite.test.mjs                 # 272 checks: auth, roles, admin, tracker, reports, tasks, isolation
   node tests/leave.test.cjs                     # leave requests + approval
   node tests/policies.test.cjs                  # policies & induction
   node tests/hiring-offers-payslips.test.cjs    # joiners, offers, payslips
   node tests/companies.test.cjs open            # company management (backend not pinned)
   node tests/privileges.test.cjs                # HR cannot create/promote/reset Admin or HR accounts
   node tests/input-validation.test.cjs          # bad dates/ids/times on write endpoints -> 4xx, never 500
   node tests/attendance-corrections.test.cjs    # correction requests: submit, approve/reject, recalculation, audit, permissions, notifications
   node tests/audit-logs.test.cjs                # audit log: capture, before/after, permissions, secrets, immutability
   node tests/documents.test.cjs                 # document requirements: config, employee view, review, scoping
   node tests/meetings.test.cjs                  # meeting links: validation, privacy, invitations, cancel
   node tests/timezone.test.cjs                  # a non-IST company keeps its own calendar day
   DATABASE_URL=dummy npx tsx tests/realtime.test.mts   # real-time: sockets, rooms, auth, reconnection (needs NO database)
   node tests/realtime-e2e.test.mjs              # real-time with two sessions and real tasks (needs the branch backend on :5002)
   node tests/route-sweep.test.cjs               # every route: 401 without a token, no 5xx on garbage ids/queries (~10 min)
   node tests/body-fuzz.test.cjs                 # garbage in every write route as all four roles (~14 min)
   ```
4. Pinned-company tests: restart the backend with `HRMS_COMPANY_SLUG=avatar-india` and run
   `node tests/companies.test.cjs pinned` and `node tests/pinned-scope.test.cjs`.

## Notes

- Tests expect the seed users (admin@avatarindia.com etc.) to exist, as in a copy of the real database.

- The browser (Edge/CDP) end-to-end scripts are not in the repo yet.
