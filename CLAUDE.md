# Avatar HRMS — Productivity & Break Tracker (Avatar India)

Standalone productivity and break tracker. Multi-tenant across three platforms: **Take Health, Avatar, Co-Lab**.
Deliberately **not sales-specific** — it serves multiple companies. Keep features and wording generic.
**Hard deadline: 2 days.**

## How to work with me

I'm a non-expert. Before implementing anything, give me four things up front:
1. What it does, in plain layman terms
2. What the feature does
3. The logic — call triggers, chain of actions
4. How the visuals will look

Whenever we build something a senior or an interviewer could ask about, explain it in simplified, interview-ready language — proactively, without being asked.

**Never make an architecture, infrastructure, cost or dependency decision silently.** Present options with tradeoffs and let me choose.

Act as a senior software developer / Forward Deployed Engineer. English only.

## Stack and layout

- **Backend** (`backend/`): TypeScript, Express 5, Prisma **7.10.0 (PINNED — do not upgrade)**, PostgreSQL on Neon, `bcryptjs`, `jsonwebtoken`. Runs on port **5001**.
- **Frontend** (`frontend/`): Next.js **16.3.5** App Router, React 19, Tailwind 4. Runs on port **3000**. API base comes from `NEXT_PUBLIC_API_URL` (default `http://localhost:5001/api`), see `frontend/lib/api.ts`.
- CORS allows 3000 and 3001 (`backend/src/server.ts`).
- **ESM** — every relative import needs the `.js` extension.
- Backend is organised by module: `src/modules/<name>/<name>.routes.ts` + `<name>.service.ts`. Prisma schema is split across files in `prisma/schema/` (`schema.prisma` holds only generator + datasource).
- Next.js 16 differs from older versions — `frontend/CLAUDE.md` / `AGENTS.md` say to read `node_modules/next/dist/docs/` before writing frontend code.

### Commands (from `backend/`)
- `npm run dev` — tsx watch
- `npm run db:migrate` then **`npm run db:generate`** (migrate does not generate)
- `npm run db:seed` — same as `npx tsx prisma/seed.ts`, safe to re-run
- `npm run db:studio`

Frontend: `npm run dev` in `frontend/`.

## Hard-won traps — read before touching these

- **Prisma 7:** `url` / `directUrl` are NOT allowed in the datasource block. They live in `prisma.config.ts`.
- **Prisma 7 needs a driver adapter:** `@prisma/adapter-pg`, `new PrismaClient({ adapter })`.
- **Generator must be `prisma-client` with an explicit `output`**, NOT `prisma-client-js`. The latter generates without error but exports no `PrismaClient`. Client is imported from `src/generated/prisma/client.js`.
- **`prisma migrate dev` does NOT run generate.** Always run both.
- **Never run `npm install prisma@latest`** — it resolves to 8.x, which renames `migrate` to `migration`.
- **ESM imports run before `dotenv.config()`.** Any module that reads `process.env` must have `import "dotenv/config"` as its FIRST line. `src/lib/prisma.ts` depends on this.
- **NEVER edit `backend/.env` from the terminal.** `Add-Content` corrupted it once by gluing a line on. Edit it in the editor only. It needs exactly 5 vars: `PORT`, `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`.
- **Express 5:** `req.params.id` is typed `string | string[]`. Always wrap in `String()`.
- `"injected env (0)"` from tsx is tsx's own counter, not a dotenv failure. Ignore it.

## Conventions that must hold

- **Timezone:** a calendar day is derived from the PLATFORM's timezone via `Intl.DateTimeFormat` and stored as `Date.UTC(y, m, d)` midnight. `@db.Date` columns come back as UTC midnight, so `toISOString().slice(0, 10)` is the correct way to read the day. Never `getDate()`.
- **Recompute-on-write:** session totals are written to `work_sessions` columns whenever a break or meeting closes. Reports READ those columns and never recalculate.
- **Meeting time counts toward productive hours ONLY when `approvalStatus` is `APPROVED`.** Implemented as `productiveSeconds = elapsed − breaks` (approved meeting time stays inside it); `meetingSeconds` is a separate view of how much of that was meetings, never added on top. Sessions saved before 2026-10-28 used the old formula (meetings subtracted) and were not recomputed.
- **Cross-company actions are blocked by filtering on the actor's own `platformId`** (e.g. meeting invites skip anyone outside the manager's company). Exception by design: `OWNER_CODES` users can see and act across companies.
- **Service error codes must have an entry in the module's route `MESSAGES` map.** An unmapped code becomes a 500. Check this whenever you add a `throw new Error("X")`.
- **Dates from clients go through `parseIsoDay` (`src/lib/dates.ts`)** — strict `YYYY-MM-DD`, real calendar days only. Don't write a local `parseDay`.
- **Multi-tenancy:** `platformId` always comes from the JWT, never from a request body or query string. Every create injects it; every query filters on it.
- **Ownership checks** on every mutation that takes an id (IDOR guard).
- **All alert thresholds come from `TeamConfig`.** Nothing hardcoded.
- **Meetings are manager-initiated only.** The employee accepts, and the clock starts on acceptance. Employees cannot initiate.
- **Batch reads with `Promise.all` and join in memory.** No N+1.
- **Enum display names are mapped for the UI** (e.g. `MeetingType.TEAM` renders as "team meeting").

## UI theme (Hireism-style, applied project-wide 2026-10-28)

- **Palette lives in `frontend/app/globals.css`**, not in pages: primary `#5368ED`, background `#F1F2FC`, cards white, text `#1E293B`, secondary text `#718096`, borders `#E5E7F4`. The Tailwind `indigo-*` and `slate-900/500` colours are overridden in an `@theme` block, so `bg-indigo-600`, `text-slate-500` etc. already render in the brand palette. Change the brand there and nowhere else.
- **Cards:** `rounded-2xl bg-white shadow-[var(--shadow-card)]`, no border. Inputs/buttons use `rounded-xl`; borders are `border-indigo-100`. Primary buttons are `bg-indigo-600 hover:bg-indigo-700`. Do not use `bg-slate-900` buttons or dark panels; hero panels are `bg-indigo-600` with white / `indigo-100` text.
- **Shell:** floating white sidebar + lavender canvas (`dashboard/layout.tsx`, tokens `--nav-*`). `--sidebar` (dark) is legacy; avoid it.
- **HR/Admin home:** `/dashboard` renders `HrDashboard.tsx` (parts in `dashboard/_hr/`, charts via `recharts`); other roles get `TodayView.tsx`. HR/Admin's own clock lives at `/dashboard/today`. The HR dashboard shows only Present/Absent (no lateness) and scopes every figure to the signed-in company.
- **Employee "Today" page (`TodayView.tsx`, redesigned 2026-10-28; parts in `dashboard/_timesheet/`):** header (welcome, role, company-timezone date/time, range preset Today/Yesterday/Last 7/Last 30/This Month/Custom ≤93 days) → three cards: **Clock-in** (live timer = productive + break, Break menu / Resume / Clock-out), **Planned hours** (backend figure: productive hours × scheduled working days — the same as Reports; Details modal shows the real shift) and **Worked hours** (productive + break, break counted once) → **My timesheets** (newest-first day rows with a horizontal timeline: working / break / overtime / late, tooltips, click opens Entry details, Entry log button). Data comes from `GET /tracker/timesheet?from&to` (own data only, `timesheet.service.ts`; totals reconcile with `/reports`). Overtime = on-site time beyond `dailyWorkHours` (only when over by more than the overtime alert minutes); late = existing `wasLateLogin/lateByMinutes`. Nothing is invented: open/missing clock-out, no-activity, leave, holiday and day-off days are shown as such. Rules kept: **Pause = start a break, Resume = end it**; one daily break budget per team; no idle-time concept; clock-in takes an optional project (`work_sessions.teamId` → a team the person belongs to; migration `20261028120000_session_project`, hand-written because the DB has drifted from the migration files — `prisma migrate dev` wants to RESET it, never allow that; apply the SQL by hand / with `migrate deploy` after backing up). Shown as a chip on the timesheet day; invites/meetings banners unchanged. Buttons are enabled from session state and every handler re-checks it.
- **Add Employee + Import Employees** (HR/Admin; buttons on the HR dashboard and the Employees page; code in `dashboard/_employees/` and `backend/src/modules/admin/employeeImport.service.ts`, routes `/admin/employees/{lookups,template,parse,preview,commit}`). One pipeline serves the single form and the spreadsheet: **parse** (file read on the backend with `read-excel-file`; `.xlsx`/`.csv`) → **preview** (nothing written) → **commit** (re-validated, ONE transaction, all rows or none). Rules: IDs, names, dates and times are never changed or renumbered (duplicates are rejected, both rows); anything that needs interpreting (a time typed as `9.30`, a blank role/email/team/manager, an end time before the start, missing shifts) is **rejected until HR ticks that exact rule**, and each affected row says so; example/empty/note rows and rows above the heading are never imported; HR can only target their own company (owners — `OWNER_CODES` — any), and only an Admin can create HR/Admin roles. New accounts get a random one-time password (bcrypt-hashed, `mustChangePassword`), returned once in the commit response and never stored or logged. No-email people get a `<id>@<company-slug>.local` placeholder and sign in by employee ID. The HR workbook's yellow columns = required (Company, Full name, Employee ID, Work email, Designation, Team, Reports to name+ID, System role). Note: the sample template is CSV (the Excel library only reads).
- **Update Employees** (third button beside Add/Import; routes `/admin/employees/update/{preview,commit}`, service `employeeUpdate.service.ts`; same wizard with `mode="update"`): fills in details for people ALREADY in the system from the same sheet layout. People are matched by Employee ID only (names/IDs are never changed; a differing name is just noted). A blank cell = leave as is. An empty field is **filled**; a field that already has a different value is a **conflict** that is left alone unless HR ticks "overwrite" for that person + field (Employee role counts as "not set" for role). Same company isolation / HR-can't-grant-HR-or-Admin rules as Import; cycles are checked against the people as they would be after the update; commit is one transaction and writes a before/after `AuditLog` row per person (`path /api/admin/employees/update/applied`).
- **Leave requests** (`/leave` page for everyone; backend `modules/leave/`, routes `/api/leave/{mine,requests,requests/:id/cancel,requests/:id/decide,summary,person/:id}`): employee requests (Casual/Sick/Earned/Unpaid, full or half day, reason required, up to 30 days back, max 60 days, overlaps blocked) → PENDING → **HR/Admin of the SAME company** approves/rejects (never their own request; manager cannot decide). Approval runs in ONE transaction: status flips (only if still PENDING) and one `leave_days` row per working day is written (shift working days minus holidays, recomputed at approval) linked by `leaveRequestId`; from then on Reports/timesheet treat those days as leave, not absence. Pending/rejected/cancelled requests change nothing. HR sees pending requests with each person's leave already taken, and a per-person yearly table (Casual/Sick/Earned/Unpaid/Other, half day = 0.5, counted from `leave_days` so HR-marked days count too) with a drill-down. No yearly quota (count only). Tables: `leave_requests` + `leave_days.leaveRequestId`; enum `LeaveDayType` gained CASUAL/EARNED; migration `20261028130000_leave_requests` (hand-written/additive, apply to the live DB after a backup — see the session_project note).
- **Policies & induction** (`/policies` page for everyone, `modules/policies/`, routes `/api/policies/{,manage,:id/file,:id/acknowledge,:id/report,:id/archive,:id/restore}`; uses the existing `induction_documents` / `induction_acknowledgements` tables, no migration): HR/Admin upload a file (PDF/image/Word, 10 MB, stored privately via `saveUpload`, folder `induction`), for the whole company or one team, required or optional. Employees open it (records `openedAt`, file served `no-store`) and may only then click "I have read this" (`acknowledgedAt`). Replacing the file bumps `version`, so everyone must accept again; old acceptances stay as history. HR sees "x of y accepted" and a per-person report (accepted with date / opened / not opened). Archived documents vanish for employees. Not routed through the tracker gate, so locked joiners can read induction material. Not enforced: nothing blocks work until a policy is accepted.
- **Application name is "Avatar HRMS"** (login, sidebar, mobile header, browser tab `<Page> | Avatar HRMS`, metadata, outgoing emails). The HR/Admin menu item "Productivity Tracker" is a feature name (their own clock) and stays.
- **Deployment pin (`HRMS_COMPANY_SLUG` in `backend/.env`, e.g. `avatar-india`; `src/lib/deployment.ts`)**: unset = every company works as before. Set = this deployment serves ONE company: only its people can sign in (others get the normal wrong-password error) and use the API (403 `NOT_PART_OF_THIS_HRMS` even with a valid token, checked in `requireAuth`); owner (`OWNER_CODES`) and Admin cross-company reach is off (`viewerIsOwner`, projects `visiblePlatformIds`, holidays `allowedPlatforms`); manager visibility (`visibleUserIds`, reports scope, task queue, `assertCanReviewTask/assertCanManage`, projects) drops other-company people even where a reporting line or team crosses companies; admin manager dropdowns, onboarding SLA/reminder emails and the stale-session/alert schedulers touch only that company. A slug that matches nothing returns 503 for everyone (fail closed). Other companies and their rows stay in the database. **Before setting it, make sure the pinned company has an HR or Admin user** (Avatar India had none on 2026-10-28; the AVT-0001 Admin belongs to the `avatar` company and would be locked out). Edit `.env` in the editor only.
- **Companies (HR/Admin only)** (`/dashboard/companies`, `modules/companies/`, routes `GET/POST /api/companies`, `POST /api/companies/:id`; no migration): list every company (names/status), create (HR and Admin), edit (HR: own company only; Admin: any). Employee counts shown for the viewer's own company only. Nobody can deactivate their own or the pinned company. A deactivated company is closed to its people (`COMPANY_INACTIVE`, checked in `requireAuth`). The slug never changes (it is how a deployment is pinned). Managers/Employees get 403 from the API and no menu item.
- **Role hierarchy is enforced in `admin.service.ts` (found by the 2026-10-29 audit):** only an ADMIN may create, promote, suspend, or reset the password of an HR or Admin account; HR cannot change their own role/status; HR is only offered the EMPLOYEE/MANAGER roles. **Every `:id`/`:userId`/`:teamId` route parameter must be a UUID** (`guardUuidParams(router)` in `src/lib/params.ts`, called right after `Router()`), otherwise the answer is 404, not a database 500. Router `fail()` helpers map Prisma/runtime input errors to 400 (`isBadInput`) and never echo raw error text to the browser. A global `textFields` middleware rejects non-text values in known text fields with a 400. Client dates always go through `parseIsoDay`; client clock times through a validated parse. **Backend tests live in `backend/tests/` (see its README): they write data, run them ONLY on a disposable Neon branch (`_guard.cjs` refuses the `.env` database).**
- **Attendance corrections + notification inbox (built 2026-10-29; migration `20261029100000_attendance_corrections`, NOT yet applied to the live DB — apply after a backup, then record it in `_prisma_migrations`):** tables `attendance_correction_requests` (one PENDING per person per day, enforced by a partial unique index), `attendance_correction_audits` (before/after session snapshot, `actedById` RESTRICT so an HR user with audit history cannot be deleted), `notifications`. Employee asks (`POST /api/attendance-corrections`, times typed as HH:MM in the COMPANY timezone, last 30 days, reason required, optional evidence file, own requests only); HR/Admin of the same company decides (`/decide`; never their own; managers cannot; reject needs a comment). Nothing changes on submit. Approval runs in ONE transaction: claim the request (409 if already decided) -> lock the day's session -> re-validate against the session as it is now -> update/create the session -> `recompute` (same function as clock-out) + `computeLate` (same formula as clock-in, shift start snapshot + current TeamConfig grace; NOTHING is waived, a corrected time still past the grace stays late) -> delete stale NO_LOGIN/LATE_LOGIN alerts -> audit row. A correction that no longer fits the recorded breaks, or closes today's running session, is refused. Reports, History, Timesheet and CSV exports read the recomputed columns, so they follow automatically; the Timesheet shows a "Corrected by HR" chip (`/tracker/timesheet` reads the audit table inside a guard so the page still loads if the table is missing). Notifications: HR/Admin get an in-app notification (+ best-effort email through the existing mailer) on submit, the employee on the decision; bell in the sidebar (`_notifications/Bell.tsx`, polls `/api/notifications` every 30 s), pending-count badge on the HR "Corrections" link and a row in the HR dashboard's Pending HR Approvals. Pages: `/dashboard/corrections` (everyone: My requests; HR/Admin: Pending/Approved/Rejected with search, date and team filters, side-by-side details, confirmations, audit history). The old ATTENDANCE_CORRECTION ticket path is kept unchanged by decision (manager-assigned, no audit snapshot, no late recompute). Half/full-day status is NOT implemented (no such rule exists in the repo; the live DB has unexplained `halfDayAfterHours`/`fullDayAfterHours` columns). Tests: `backend/tests/attendance-corrections.test.cjs` (93 checks).
- **Audit log screen, document requirements, meeting links (built 2026-10-29). Migrations NOT yet applied to the live DB** (order: `20261029110000_audit_log_structured` → `scripts/backfill-audit.ts --apply` (dry-run first) → `20261029111000_audit_log_immutable`; `20261029120000_employment_type_and_requirement_scope`; `20261029130000_meetings`; plus `20261029100000_attendance_corrections`). Every migration has a `down.sql`. **RULE LEARNED THE HARD WAY: the live backend runs `tsx watch`, so new code is live the moment it is saved. Never add a column to an EXISTING table in the Prisma schema before the live DB has it (every query on that table reads all columns and fails). New features use NEW tables only, and code that reads them must tolerate "table does not exist" until the migration is applied** (see `scopeMap`/`typesOf` in `onboarding.service.ts`, the audit fallback in `middlewares/audit.ts`, the guarded corrections read in `timesheet.service.ts`).
  - **Audit log** (`/dashboard/audit-logs`, HR/Admin of their own company, read-only `GET /api/audit-logs[/filters|/:id]`; no write route exists): built on the existing `audit_logs` table + middleware. New columns (module, action, recordType, recordId, targetUserId, summary, before, after) are filled automatically from the route catalogue `lib/auditCatalog.ts` (add a line there for every new write route) and enriched by services via `auditNote()/changedFields()` (`lib/auditContext.ts`, AsyncLocalStorage; one row per request). Before/after captured for employee changes (role/status/access = action PERMISSION), password resets (value never recorded), sign-ins, leave decisions, attendance corrections, document review and requirements, company edits, meetings. Secrets are scrubbed on write AND on read. The IP address is shown to Admin only. A database trigger refuses UPDATE/DELETE/TRUNCATE of audit rows (only the FK `SET NULL` clearing of a deleted user/company is allowed). Search finds what a person did AND what was done to them. Notification "mark read" and import previews are not logged.
  - **Document requirements** (`/dashboard/documents`: everyone = My documents; HR/Admin = Employee tracking + Requirements): reuses `document_requirements`/`employee_documents` and the existing upload/review routes (`/onboarding/me/documents`, `/onboarding/documents/:id/review`, `/onboarding/requirements`). Statuses shown as Not submitted / Submitted / Verified / Rejected (maps REQUESTED/SUBMITTED/APPROVED/REJECTED). Optional **employment type** per employee (`employee_profiles`) and per-requirement scope (`document_requirement_scopes`): no row = everyone / unspecified = sees every requirement. Scoping is applied in `recomputeOnboarding` and the joiner checklists too. Deactivating a requirement never deletes files (listed as "no longer required"). The starter list that `ensureRequirements` seeds for a company with none is kept (editable). Employment type is set from the HR tracking dialog only (not in Add/Import/Update Employees yet).
  - **Meeting links** (`/dashboard/meetings`, `/api/meetings`): tables `meetings`, `meeting_attendees`; separate from `tracker_meetings` (live worked-time meetings). Manager/HR/Admin create; the organizer edits; the organizer or HR/Admin cancel. Details (description, link, invitees) are visible to organizer + invitees ONLY, even HR/Admin; HR/Admin get `/api/meetings/oversight` (title, organizer, time, head-count). Pasted link must be https, no credentials, no localhost/IP/single-word host; provider recognised (Google Meet / Teams / Zoom / Other); NO provider integration, nothing is auto-created. Invitations/changes/cancellations go to the notification inbox (+ best-effort email). Times are typed in the company timezone and stored as UTC.
  - **Idle-time tracking is NOT built** (on hold pending company policy and an employee notice). Agreed design when it is: opt-in per team, employee acceptance first, per-minute yes/no "interaction inside an HRMS tab" only, idle = no interaction for at least a threshold while clocked in and not on break/meeting, untracked minutes are never idle, never subtracted from worked hours, HR sees summaries only.
- `GET /reports` accepts an optional `userId` that can only narrow the viewer's already-permitted people.
- Existing pages (Live Team, Reports, History) still show late-login information; only the new HR dashboard omits it.

## Auth

- bcrypt cost 10 (via `bcryptjs`).
- JWT HS256 carrying `{ userId, platformId, role }`. Bearer header, stateless.
- `requireAuth` and `requireRole` middleware (`src/middlewares/auth.ts`). `requireAuth` also reads the live user row on every request: SUSPENDED/EXITED users get 401 immediately, and `role`/`platformId` come from the database, not the token (a demotion applies on the next request).
- Login accepts an email or an employee code. The same email can exist on several platforms, so email login tries every account with that email and signs in the one whose password matches.
- Login is rate-limited (`loginLimiter`, 10 attempts / 15 min per IP + identifier, cleared on success). The key reads the first `X-Forwarded-For` value, so it is only trustworthy behind a proxy that overwrites that header.
- Login returns the same error for unknown email and wrong password (prevents email enumeration).
- `publicUser()` never returns `passwordHash`.

## Built and working

Login with roles · dashboard shell with role-filtered sidebar · clock in/out · tagged breaks · live three-counter timer · shift-based late detection · manager Live Team view with alerts panel · manager→employee meeting invites with accept/decline · weighted Daily Tasks with carry-forward · My History with CSV export · stale-session scheduler every 15 min · alert generation (`LATE_LOGIN`, `BREAK_OVERAGE`, `OVERTIME`, `LOW_PRODUCTIVITY`, `NO_LOGIN`) via idempotent upsert · Reports (person/day/week/month/year with CSV export).

Also present in the backend (modules exist): **Admin** (users, teams, shifts, TeamConfig, leave — API-tested), **tickets** with internal notes (API-tested), **holidays** (API-tested), and **onboarding, offers, payroll, projects** (only their role guards were tested).

## Seed users

| Email | Password | Role |
|---|---|---|
| admin@avatarindia.com | (dev seed password, see backend/prisma/seed.ts) | ADMIN |
| manager@avatarindia.com | (dev seed password, see backend/prisma/seed.ts) | MANAGER |
| priya@avatarindia.com | (dev seed password, see backend/prisma/seed.ts) | EMPLOYEE |
| rahul@avatarindia.com | (dev seed password, see backend/prisma/seed.ts) | EMPLOYEE |

Testing two users at once needs an incognito window — `localStorage` is per-origin and shared across tabs.

## Still to build, in order

> Status note (2026-10-28): items 1, 3, 4 and 5 below now have backend modules in the repo (see "Built and working"). The list is kept as originally written; re-confirm what is left on the UI side before relying on it.

1. **Admin** — users, teams, shifts, TeamConfig editing, on-leave marking
2. **Visual polish pass**
3. **HR onboarding** + offer letter templates, sending, acceptance
4. **Ticket system** — HR query, tech, admin request, attendance correction
5. **Holiday calendar + shift management UI**
6. **Biometric Excel import + reconciliation** — BLOCKED: need a sample export, and to know whether rows identify people by biometric ID, employee code or name
7. **Hardening** — DPDP compliance, QA across all four roles, timezone and month-boundary tests, backup/restore, runbook
8. **Optional AI/FDE showcase:**
   - "Ask Your Data" — natural language → a constrained query spec. The model never writes SQL.
   - "AI Day Summary" — deterministic stats, LLM for wording only, one call per user per day, degrades gracefully.

## Known tech debt

- (none open — `platformToday()` now lives in `src/lib/dates.ts`; `server.ts` loads dotenv via `import "dotenv/config"` on line 1.)

## Open issues (as of 2026-10-28)

- None known in the API paths covered by the test run below.
- Sign-out, Reports padding, Reports stat-card captions and the `master`/`main` mismatch from the 2026-10-15 list are resolved (login form is at `/login`; Reports uses `p-8`; "Late days" tile now reads "of N days present").
- **Not yet deployed:** the 2026-10-28 backend fixes (login lockout, live status check, cross-company invite guard, error-code mapping, strict dates, meeting/productive formula) exist only in the working tree until the live server is redeployed.
- **Not yet covered by tests:** browser UI, onboarding/offers/payroll/projects flows beyond role guards, the 15-minute scheduler and alert generation, email sending, timezone behaviour on non-IST platforms.

## API test run (2026-10-28)

No automated test suite exists in the repo. A scripted API run was done against a **Neon branch copy** of the database (never the original): 272 checks, all passing after fixes. It covered login/token attacks, a role × endpoint access matrix (ADMIN, HR, MANAGER, EMPLOYEE), admin CRUD, clock-in/breaks/meetings, dashboard/report numbers vs raw rows, tasks and score weighting, tickets, holidays, and cross-company isolation. Behaviours worth knowing, confirmed by that run:

- Clocking in again on the same day **resumes** the session and logs the gap as an `OTHER` break ("Away between clock-out and clock-in").
- Removing a team member is a **soft** removal (`isActive=false`, `leftAt` set).
- A manager may re-grade an already-graded task; an employee may delete an approved task only while it is still `PENDING`.
- Users created in Admin must change their password before the tracker unlocks (`mustChangePassword` gate).
- Always test against a Neon branch, not the live database: the live one is in use.

## Verified in a browser (2026-10-15, as admin)

- Daily Tasks: add (HIGH, 3pt) → score 0/3, 0%; complete → 3/3, 100%; delete → 0/0. No console errors.
- Reports: Group by Person (4 rows), Day (2 rows), Week (1 row, 2026-W42) all load; totals reconcile (9h00 + 8h49 = 17h49 vs 16h target = 111%).
