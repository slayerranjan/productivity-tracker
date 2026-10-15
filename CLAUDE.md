# Productivity & Break Tracker — Avatar India

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
- **Meeting time counts toward productive hours ONLY when `approvalStatus` is `APPROVED`.**
- **Multi-tenancy:** `platformId` always comes from the JWT, never from a request body or query string. Every create injects it; every query filters on it.
- **Ownership checks** on every mutation that takes an id (IDOR guard).
- **All alert thresholds come from `TeamConfig`.** Nothing hardcoded.
- **Meetings are manager-initiated only.** The employee accepts, and the clock starts on acceptance. Employees cannot initiate.
- **Batch reads with `Promise.all` and join in memory.** No N+1.
- **Enum display names are mapped for the UI** (e.g. `MeetingType.TEAM` renders as "team meeting").

## Auth

- bcrypt cost 10 (via `bcryptjs`).
- JWT HS256 carrying `{ userId, platformId, role }`. Bearer header, stateless.
- `requireAuth` and `requireRole` middleware (`src/middlewares/auth.ts`).
- Login returns the same error for unknown email and wrong password (prevents email enumeration).
- `publicUser()` never returns `passwordHash`.

## Built and working

Login with roles · dashboard shell with role-filtered sidebar · clock in/out · tagged breaks · live three-counter timer · shift-based late detection · manager Live Team view with alerts panel · manager→employee meeting invites with accept/decline · weighted Daily Tasks with carry-forward · My History with CSV export · stale-session scheduler every 15 min · alert generation (`LATE_LOGIN`, `BREAK_OVERAGE`, `OVERTIME`, `LOW_PRODUCTIVITY`, `NO_LOGIN`) via idempotent upsert · Reports (person/day/week/month/year with CSV export).

## Seed users

| Email | Password | Role |
|---|---|---|
| admin@avatarindia.com | Admin@12345 | ADMIN |
| manager@avatarindia.com | Manager@12345 | MANAGER |
| priya@avatarindia.com | Employee@12345 | EMPLOYEE |
| rahul@avatarindia.com | Employee@12345 | EMPLOYEE |

Testing two users at once needs an incognito window — `localStorage` is per-origin and shared across tabs.

## Still to build, in order

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

## Open issues (as of 2026-10-15)

- **Sign-out is broken.** The login form is at `/` (`frontend/app/page.tsx`), but sign-out pushes to `/login`. `frontend/app/login/page.tsx` is a leftover profile page that, when logged out, redirects to `/login` (itself) and sits on "Loading…" forever. Verified in a browser.
- **Reports page has no outer padding** — content touches the top and right edges (other pages use `p-8`).
- **Reports stat-card captions look mismatched:** "Late days" card shows "0m on break"; "Alerts" card shows "0% task score". Confirm intent.
- Git: working branch is `master` while the main branch is `main`.

## Verified in a browser (2026-10-15, as admin)

- Daily Tasks: add (HIGH, 3pt) → score 0/3, 0%; complete → 3/3, 100%; delete → 0/0. No console errors.
- Reports: Group by Person (4 rows), Day (2 rows), Week (1 row, 2026-W42) all load; totals reconcile (9h00 + 8h49 = 17h49 vs 16h target = 111%).
