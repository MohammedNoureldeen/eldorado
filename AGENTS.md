# AGENTS.md — Eldorado Operations Platform: AI Context & Handoff

This file gives any AI assistant complete context on what this project is, everything implemented so far, how to verify work, and the rules that must never be broken.

## 1. What this project is

A secure internal operations platform for a small FC-coin resale business (1 owner/admin + 2 workers). It manages manual Eldorado marketplace orders from intake through FUT Transfer fulfillment, financial reconciliation, worker KPIs, and monthly payroll.

Primary workflow:

```text
Eldorado order (entered manually) → assignment → credential validation → FUT prepare/price
→ worker confirmation → FUT submit → status sync → delivery proof → reconciliation → KPI/payroll
```

Deliberate scope limits (do not "improve" past these without explicit owner sign-off):

- No automatic Eldorado order import; orders are entered manually.
- FUT purchases always require human confirmation; no auto-submit.
- No Eldorado pause/unpause monitoring.
- No worker surveillance (no screenshots/keystrokes); shifts are explicit clock events + dashboard heartbeat only.

## 2. Tech stack

- Next.js 14 (App Router) + React 18 + TypeScript (strict), path alias `@/*` → `src/*`.
- PostgreSQL 15+ via Prisma ORM (`prisma/schema.prisma`, one migration `20260805000000_init`).
- Auth: Argon2id passwords, DB-backed opaque sessions (HMAC-hashed tokens), double-submit CSRF cookies, optional admin TOTP 2FA.
- Storage: S3-compatible private bucket for delivery proofs (`@aws-sdk/client-s3` + presigner).
- Deployment: Vercel; `vercel.json` cron hits `/api/jobs/run` every 5 minutes (Bearer `HEALTHCHECK_TOKEN`).
- Tests: Node test runner via `tsx --test tests/*.test.ts` (no Jest/Vitest). Smoke tests are `tsx` scripts.

## 3. Implementation status — what has been built

All application code was delivered in a single initial commit ("Initial Eldorado operations platform"). Phases 1–7 of `PROJECT_PLAN.md` are implemented **in code**; remaining work is external/operational gates (see §9).

### 3.1 Foundation (done)

- Full Prisma schema: 24 models + 14 enums (`Organization`, `User`, `WorkerProfile`, `Session`, `Shift`, `ShiftEvent`, `Order`, `OrderStatusHistory`, `CustomerCredential`, `CredentialAccessEvent`, `FutOrder`, `FutApiEvent`, `FinancialEntry`, `ExchangeRate`, `ProofFile`, `OrderNote`, `AuditEvent`, `NotificationEvent`, `PayrollPeriod`, `PayrollEntry`, `PayrollAdjustment`, `SalaryPolicy`, `Setting`, `BackgroundJob`).
- UUID primary keys, UTC timestamps everywhere (Africa/Cairo display only), integer minor-unit money + ISO currency codes.
- Append-only triggers on audit/financial tables (migration SQL rejects UPDATE/DELETE).
- Auth: `src/lib/auth/` — `password.ts` (Argon2id), `session.ts` (cookies, CSRF, requireSession), `totp.ts` (admin 2FA, ±1 step), `rbac.ts` (role scoping).
- Middleware (`middleware.ts`): HTTP→HTTPS redirect in production for `/api`, `/dashboard`, `/login`.
- Rate limiting (`src/lib/security/rate-limit.ts`) — NOTE: process-local.
- Config loader `src/lib/config.ts`; audit writer `src/lib/audit.ts`; error mapping `src/lib/errors.ts`; API helpers `src/lib/api.ts`.

### 3.2 Manual MVP (done)

- Order service `src/lib/orders/service.ts`: create/list/get/update with optimistic `version` concurrency, duplicate Eldorado-ID prevention, assignment, status changes with audited history.
- Order state machine `src/lib/domain.ts`: 12 statuses (DRAFT, WAITING_FOR_DETAILS, READY_FOR_REVIEW, APPROVED, SUBMITTED_TO_FUT, PROCESSING, CUSTOMER_ACTION_REQUIRED, COMPLETED, FAILED, CANCELLED, DISPUTED, REFUNDED) with `canTransition`/`assertTransition` guards.
- Customer credentials: field-level AES-256-GCM encryption with versioned keys (`src/lib/crypto/secrets.ts`); masked by default; reveal requires reason + active assigned order and is audited (`CredentialAccessEvent`); 7-day post-closure deletion deadline (`closureDeletionDate`) enforced by job (`deleteExpiredCredentials`); admin immediate deletion endpoint.
- Proof uploads `src/lib/storage.ts`: type/magic-byte/size (10 MB max)/checksum validation, optional malware scan, private S3 put, short-lived signed URLs.
- Shifts `src/lib/shifts.ts`: clock in/out, break start/end, heartbeat, disconnect, admin corrections with reason.
- Order notes `src/lib/order-notes.ts`.

### 3.3 Reporting & payroll (done)

- Ledger `src/lib/ledger.ts`: append-only financial entries, fixed-point FX math (`bigint` rates, `parseFixedRate`, `convertMinorToEgp` — never floats), refunds as adjustment entries, per-order profit, reconciliation with locked exchange rates.
- Reports `src/lib/reports.ts`: `summaryReport`, `exportOrdersCsv` (CSV never contains credentials).
- Payroll `src/lib/payroll.ts`: draft → approve → paid lifecycle; `calculatePayroll` in `domain.ts` implements the tiered policy (default: <200 clean orders = 3,000 EGP; 200–249 = 3,500; 250+ = 5,000 + 150 EGP per full 10-order block above 250; thresholds configurable via `SalaryPolicy`).
- Telegram queue `src/lib/notifications/telegram.ts`: enqueue + `deliverPendingTelegram` via background jobs; payloads never contain credentials (`redactSensitive`).

### 3.4 FUT Transfer integration (done, sandbox/placeholder)

- `src/lib/integrations/fut.ts`: `HttpFutProvider` with prepare/price, confirm/submit (order UUID as idempotency key), status sync, cancel, balance; bounded retries + exponential backoff, timeouts, circuit breaker, provider-status → internal-status mapping (`mapFutStatus`), sanitized `FutApiEvent` logging via `redactSensitive`, correlation IDs.
- Endpoint paths in the adapter are GENERIC PLACEHOLDERS on purpose. Do not point them at a real provider until the discovery gate in `docs/OPERATIONS.md` is complete.

### 3.5 Background jobs (done)

- `src/lib/jobs.ts`: DB-backed queue (`enqueueJob`, `runBackgroundJobs`) executed by `/api/jobs/run` (Vercel cron every 5 min, token-protected). Handles FUT sync, Telegram delivery, credential deletion, retention verification.
- Empty dirs `src/lib/jobs/`, `src/lib/reports/` exist but are unused; job logic lives in `jobs.ts`/`reports.ts`.

### 3.6 Admin (done)

- `src/lib/admin.ts`: worker CRUD, list, session revocation. Settings store `src/lib/settings.ts` (approval limits, retention, salary policy, etc.).

### 3.7 UI (done, functional-minimal)

- `app/login/page.tsx` (login + 2FA), `app/dashboard/page.tsx` + `app/dashboard/DashboardClient.tsx` (single role-aware dashboard: orders, shifts, credentials, FUT confirm, proof, payroll, reports, settings), `app/layout.tsx`, `app/globals.css`, root `app/page.tsx`.

## 4. HTTP API surface (`app/api/`)

| Area | Routes |
| --- | --- |
| Auth | `auth/login`, `auth/logout`, `auth/me`, `auth/2fa/setup`, `auth/2fa/enable` |
| Orders | `orders` (list/create), `orders/[id]` (get/update), `[id]/status`, `[id]/credentials` (add/delete), `[id]/credentials/reveal`, `[id]/notes`, `[id]/prepare`, `[id]/confirm`, `[id]/sync`, `[id]/proof` (+ `[proofId]` signed URL), `[id]/financial`, `[id]/reconcile` |
| Shifts | `shifts`, `shifts/events` |
| Payroll | `payroll`, `payroll/[id]/approve` |
| Reports | `reports/summary`, `reports/export` |
| Admin | `admin/workers`, `admin/sessions/revoke`, `settings` |
| Ops | `health`, `integrations/fut/balance`, `jobs/run` (cron, Bearer token) |

All mutating browser requests require CSRF header; authorization is enforced in the service layer (`requireSession` + role + organization + assignment checks), not just at the route.

## 5. Tests & verification

- `tests/domain.test.ts` (11 tests): credential encryption round-trip, state-machine guards, salary boundaries (199/200/249/250/259/260), fixed-point money math, redaction, TOTP, shift minute splits, 7-day retention, Argon2id + RBAC, login rate limiter, end-to-end vertical workflow (approval → confirmation → proof → reconcile).
- `tests/integration.test.ts` (4 tests): FUT adapter auth/status mapping, malformed-response rejection without body leakage, retry vs auth-failure behavior, proof validation (type/magic/size/checksum).
- `scripts/smoke.ts` — provider-independent workflow smoke test; `scripts/db-smoke.ts` — same against real PostgreSQL.

Full verification set — run ALL of these after any change and ensure they pass:

```powershell
npm run typecheck
npm run lint
npm test
npm run smoke
npm run db:smoke   # needs DATABASE_URL in .env
npm run build
```

Local setup: `npm install` → `Copy-Item .env.example .env` (set `DATABASE_URL`, `SESSION_COOKIE_SECRET`, `CREDENTIAL_ENCRYPTION_KEYS`) → `npm run db:generate` → `npm run db:migrate` → `npm run db:seed` (uses `SEED_*` vars) → `npm run dev`.

## 6. Hard invariants — never break these

1. Money is integer minor units + ISO currency code. FX uses fixed-point `bigint` math. Never floats for money or rates.
2. Timestamps stored in UTC. Cairo conversion is display-only.
3. Customer credentials: encrypted at field level (AES-256-GCM, versioned keys), never in logs, responses, list/detail APIs, Telegram, CSV exports, FUT event snapshots, or URLs. Reveal requires authorization + reason + audit event. Deleted 7 days after order closure.
4. Audit and financial history is append-only (DB triggers). Corrections = new rows with actor + reason; never UPDATE/DELETE history.
5. FUT submission requires human confirmation, the order UUID as idempotency key, and optimistic version check.
6. Provider secrets are server-side env vars only; never accepted from the browser, never committed.
7. Role boundaries: workers only touch assigned active orders; payroll approval, settings, workers, and reconciliation are admin-only.
8. Refunded/charged-back orders lose KPI credit; payroll is immutable after `PAID` (later reversals go to the next period as adjustments).
9. Eldorado order IDs are unique; submission requires platform, coin quantity, sale amount, credentials, and assigned worker.

## 7. Key file map

```text
PROJECT_PLAN.md            Product spec & plan (source of truth for requirements)
README.md                  Setup, scripts, configuration overview
docs/PHASES.md             Phase delivery map: code done vs external gates
docs/OPERATIONS.md         Runbook: FUT discovery gate, daily/weekly/monthly ops, backup, pilot, rollout
docs/SECURITY.md           Security controls, known limitations, key rotation & incident response
.env.example               Full configuration surface (documented)
prisma/schema.prisma       All models/enums; prisma/seed.ts seeds admin+worker
middleware.ts              HTTPS redirect
app/                       Next.js App Router: login, dashboard, all API routes
src/lib/domain.ts          State machine, payroll calc, profit calc, redaction, retention date
src/lib/orders/service.ts  Order lifecycle service (the core business logic)
src/lib/ledger.ts          Financial entries, FX, refunds, reconciliation
src/lib/integrations/fut.ts FUT HTTP adapter (placeholder paths)
src/lib/crypto/secrets.ts  Credential encryption/decryption
src/lib/auth/              sessions, passwords, TOTP, RBAC
src/lib/jobs.ts            Background job queue runner
tests/                     Node test-runner tests (tsx)
scripts/                   smoke + db-smoke verification scripts
```

## 8. Code conventions

- TypeScript strict; no `any` leaks in public service signatures; services take an `Actor` (session context) first arg and enforce authorization internally.
- Routes are thin: parse request → call service in `src/lib` → `errorResponse(error)` mapping. `export const dynamic = 'force-dynamic'` on API routes.
- Errors: throw typed errors from `src/lib/errors.ts`; do not return ad-hoc status codes.
- Tests use `node:test` style (`test(...)`) run through `tsx`; smoke scripts are plain async steps with console output.
- No new dependencies unless truly necessary (current deps: Prisma, argon2, AWS SDK S3 only).

## 9. What is NOT done (external gates / future work)

- FUT provider discovery gate: real endpoints, auth, rate limits, sandbox fixtures, permission to automate (`docs/OPERATIONS.md`). Adapter paths are placeholders until then.
- Real Telegram recipients, fee/FX rule configuration, Eldorado account workflow notices.
- Separate staging/production environments, managed backups + restore rehearsal, dependency/vulnerability scanning, load/concurrency testing, security review.
- Pilot gate: owner + 1 worker must complete ≥50 real orders with no unexplained financial difference.
- Move rate limiting + FUT circuit breaker to shared storage (Redis/DB) before running multiple instances (currently process-local).
- Optional: Sentry, malware scanner, uptime monitoring wiring.
- Future (not v1): customer self-entry links, permitted Eldorado automation.

## 10. Rules for AI assistants

1. Read `PROJECT_PLAN.md` and `docs/PHASES.md` before changing business logic; they define acceptance criteria.
2. Preserve all §6 invariants; any change touching money, credentials, audit, or FUT confirmation needs matching test updates.
3. Never commit `.env`, secrets, real provider responses, or customer data; fixtures must be sanitized.
4. After any code change, run the full §5 verification set and report results.
5. Do not add comments to code unless asked. Do not add surveillance features, auto-submission, or automatic Eldorado scraping.
6. Git note: repo ownership differs from the current Windows user; if git commands fail with "dubious ownership", use `git -c safe.directory='D:/Side Projects/eldorado' <cmd>`. Only commit when explicitly asked.
