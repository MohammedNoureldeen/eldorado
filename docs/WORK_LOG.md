# Shared Development Work Log

Mandatory cross-developer handoff. Put the newest entry below this introduction.

## Current state

- Active phase: Phases 0-4 implemented and sanitized verification complete; Phase 3 controlled live verification and the Phase 5 fifty-order real pilot are externally blocked. Phase 5 engineering hardening and the fail-closed Phase 6 automation foundation are complete; automation remains stopped.
- Active plan: `docs/ACTIVE_MVP_PLAN.md`.
- Decisions: `docs/DECISIONS.md`.
- Verified working copy: `D:\eldorado-main\eldorado-main`.
- Real FUT calls blocked until test credentials or controlled-test scope is approved.

## 2026-08-13 - Codex - Operations-desk login redesign

- Phase / acceptance criterion: visual quality and secure-access usability follow-up.
- Summary: Replaced the unstyled login card with a responsive private operations-desk composition derived from the real Eldorado-to-FUT workflow. Added a concrete live-order ticket, manual-confirmation state, security/audit signals, improved field hierarchy, loading/error states, reduced-motion handling, and `/install` to `/login` redirect.
- Files changed: `app/login/page.tsx`, `app/globals.css`, `app/install/page.tsx`, and this log.
- Migration/schema impact: none.
- Security/accounting impact: authentication behavior and protections are unchanged; copy reinforces private role-based access, encrypted credentials, manual confirmation, and audited sessions. The illustrative ticket uses sanitized static values only.
- Commands and results: browser visual inspection passed at the live local URL; `/install` redirects to `/login`; owner credentials successfully reached the dashboard; typecheck passed; lint passed with zero warnings/errors; tests passed 25/25; production build passed with `/install` and `/login` in the route manifest.
- Decisions needed: final brand name/logo can replace the temporary EO wordmark later.
- Blockers: none for the redesign; real FUT and pilot gates remain unchanged.
- Exact next step: review the refreshed local login, then apply the same stronger visual system to the dashboard if the direction is approved.

## 2026-08-13 - Codex - Phase 4 verification, Phase 5 hardening, and guarded Phase 6 foundation

- Phase / acceptance criterion: Phase 4 DB/browser exit evidence; Phase 5 engineering hardening; Phase 6 fail-closed automation foundation.
- Summary: Verified owner economy, settings, payroll, audit, FUT balance, retention, and worker isolation against disposable PostgreSQL in the browser. Added shared atomic PostgreSQL login limiting, credential retention/rotation owner controls, CSP/HSTS/API no-store headers, hardening/load/backup tools, encrypted restore verification, automation policy/evaluator, protected owner routes, exact activation acknowledgement, explicit limits, order execution through the existing single-submit service, audit history, and emergency stop. Default remains manual with kill switch active.
- Files changed: `prisma/schema.prisma`, migration `20260813010000_shared_rate_limits`, `next.config.mjs`, `package.json`, `src/lib/security/rate-limit.ts`, `src/lib/security/credential-maintenance.ts`, `src/lib/automation.ts`, `src/lib/orders/service.ts`, authentication/security/automation routes, `app/dashboard/DashboardClient.tsx`, hardening/backup/load scripts, tests, and plan/security/operations/evidence documentation.
- Migration/schema impact: additive `RateLimitBucket` table/index; verified on existing and fresh disposable databases. No production data used.
- Security/accounting impact: login throttles are shared and atomic; credentials can be rotated without plaintext persistence and retention health is visible owner-only; automation cannot run without every safety condition and explicit owner activation; emergency stop returns to manual/kill state; provider submission still uses the durable database claim and UUID recovery; owner ledger reconciliation remained exact.
- Commands and results: typecheck passed; lint passed zero warnings/errors; tests passed 25/25; production build passed; hardening smoke passed with 8 concurrent confirmations/1 provider create, role isolation, seven-day retention, key rotation/deletion, 10-of-20 shared limiter allowance, automation emergency stop, and append-only audit rejection; load smoke passed 100 reads/200 writes with 232 ms p95; encrypted backup/restore hashes and row counts matched; owner and worker browser QA passed. Exact evidence is in `docs/HARDENING_EVIDENCE.md`.
- Decisions needed: actual marketplace fee, owned-sender cost per 100K, final salary policy, managed hosting/storage/monitoring choices, and written automation activation approval after the pilot.
- Blockers: no approved FUT test credentials/scope and no public sandbox; 50 real manual orders cannot be completed in sanitized development.
- Exact next step: owner provides a low-risk live-test scope and credentials; run `docs/FUT_TRANSFER_CONTRACT.md`, deploy a managed staging environment, then conduct the owner + one-worker 50-order manual pilot. Do not enable automation before sign-off.

## Entry template

```text
### YYYY-MM-DD - Developer - Task
- Phase / acceptance criterion:
- Summary:
- Files changed:
- Migration/schema impact:
- Security/accounting impact:
- Commands and results:
- Decisions needed:
- Blockers:
- Exact next step:
```

## 2026-08-13 - Codex - MVP plan and handoff

- Phase / acceptance criterion: planning prerequisite for Phase 0.
- Summary: Consolidated owner requirements and public FUT Postman contract; defined manual-first hybrid fulfillment, USD economy, permissions, safety repairs, phases, and acceptance gates.
- Files changed: documentation only.
- Migration/schema impact: planned only.
- Security/accounting impact: documented redaction, unknown-result recovery, USD cents, fee policy, transactional refunds, retention fixes.
- Commands and results: inspected D: documentation; implementation verification not run.
- Decisions needed: see `docs/DECISIONS.md`.
- Blockers: FUT test scope, payroll policy, actual marketplace fee.
- Exact next step: run Phase 0 baseline verification in `D:\eldorado-main\eldorado-main`, record results, implement repairs with regression tests.

## 2026-08-13 - Codex - Phase 0 baseline and safety repairs

- Phase / acceptance criterion: Phase 0 baseline/safety; clean install, verification, known safety gaps repaired, production build, and zero known npm vulnerabilities.
- Summary: Corrected refund atomicity, terminal credential-retention scheduling, payroll handling-rate inputs, stale background-job recovery, Telegram notification claiming, and production configuration fail-fast validation. Upgraded Next/React patch line, migrated Next 15 async route parameters, and added dependency overrides for patched PostCSS and Sharp.
- Files changed: `package.json`, `package-lock.json`, `instrumentation.ts`, `src/lib/config.ts`, `src/lib/domain.ts`, `src/lib/jobs.ts`, `src/lib/ledger.ts`, `src/lib/notifications/telegram.ts`, `src/lib/orders/service.ts`, `src/lib/payroll.ts`, all dynamic `src/app/api/**/[id]/**/route.ts` handlers, and `tests/domain.test.ts`.
- Migration/schema impact: none in Phase 0.
- Security/accounting impact: production refuses weak/missing core secrets; refunds now transition, reverse the ledger, schedule deletion, audit, and create payroll adjustment atomically; closed FUT orders schedule credential deletion; stale jobs and notification claims are lease-recoverable; payroll handling rate uses assigned valid orders rather than completed orders twice.
- Commands and results: `npm ci` passed; `npm run db:generate` passed; `npm run typecheck` passed; `npm run lint` passed with zero warnings/errors (Next reports its lint command is deprecated); `npm test` passed 17/17; `npm run smoke` passed; `npm audit --json` reported 0 vulnerabilities; `npm run build` passed on Next 15.5.21. Database smoke was not run because no project `.env`/PostgreSQL connection is configured.
- Decisions needed: see `docs/DECISIONS.md`; no Phase 0 decision blocks Phase 1 schema work.
- Blockers: DB-backed integration verification remains gated on a configured development PostgreSQL instance. Real FUT calls remain gated on approved test credentials/scope.
- Exact next step: implement Phase 1 additive schema/domain migration for generated references, optional marketplace reference, customer/platform/coin inputs, hybrid fulfillment, USD cents, effective-dated fee/visibility policy, and provider-operation metadata.

## 2026-08-13 - Codex - Phase 1 schema and domain

- Phase / acceptance criterion: Phase 1 schema/domain; both fulfillment sources represented without provider calls, additive legacy-safe migration, services, sanitized fixtures, and tests.
- Summary: Added generated immutable order references, optional normalized marketplace references, customer identity/fingerprint, 200K canonical coin minimum, USD-cent order accounting, effective-dated 5% fee policy snapshots, hybrid fulfillment source, duplicate warnings, durable FUT submission state, provider/mother/external IDs, supplier/sender/method/risk fields, and quote/sync timestamps.
- Files changed: `prisma/schema.prisma`, `prisma/migrations/20260813000000_mvp_v2_domain/migration.sql`, `prisma/seed.ts`, `src/lib/domain.ts`, `src/lib/orders/service.ts`, `src/lib/jobs.ts`, `src/lib/reports.ts`, `src/lib/testing/workflow.ts`, order API routes, smoke scripts, `tests/domain.test.ts`, `tests/fixtures/mvp-orders.json`, and `docs/DOMAIN_MODEL.md`.
- Migration/schema impact: additive migration backfills legacy references/customer/source/fee values; initializes per-organization/year counters and fee policies; preserves nullable `eldoradoOrderId` as a compatibility column; adds optional-NULL marketplace uniqueness and FUT metadata.
- Security/accounting impact: customer fingerprints are organization-scoped SHA-256 values and exclude credentials; credentials now require at least one backup code; snapshots remain credential-free; all new order economy is fixed USD cents with the selected fee rate/value snapshotted.
- Commands and results: Prisma format/validation passed; schema diff matched the hand-written migration; fresh PostgreSQL 16 migration deploy passed; migration over a populated legacy fixture passed and produced `ELD-2026-000001`; seed passed; database smoke passed; typecheck passed; lint passed; tests passed 19/19; in-memory smoke passed; production build passed. The disposable `eldorado-codex-postgres` container and test-only data were removed after verification.
- Decisions needed: D-03 through D-05 remain open but do not block the manual fake-provider worker flow.
- Blockers: real FUT verification still requires approved test credentials/scope.
- Exact next step: build Phase 2 responsive worker My Work, New Order, Prepare, explicit Confirm, and Order Workspace flows with strict role scoping and a fake provider path.

## 2026-08-13 - Codex - Phase 2 worker manual-order MVP

- Phase / acceptance criterion: Phase 2 worker MVP; responsive My Work, New Order, Prepare, Confirm, and Order Workspace; strict worker scoping; fake-provider end-to-end flow.
- Summary: Replaced the legacy dashboard table with a responsive operational workspace, structured manual-order form, two-source selector, USD inputs, encrypted credential/backup-code setup, generated reference/duplicate warning feedback, live quote preparation, dedicated explicit-confirmation modal, worker-enabled status sync, proof upload, timeline, notes, and completion flow. Added deterministic local fake FUT and non-persistent local proof modes.
- Files changed: `app/dashboard/DashboardClient.tsx`, `app/globals.css`, `.env.example`, `src/lib/config.ts`, `src/lib/integrations/fut.ts`, `src/lib/storage.ts`, `src/lib/orders/service.ts`, and `tests/domain.test.ts`.
- Migration/schema impact: none.
- Security/accounting impact: worker detail responses omit credential-access and financial-ledger collections; quote/cost values follow the visibility setting; fake FUT and memory proof modes are rejected by production configuration; final FUT submit is disabled until the worker checks the review acknowledgement; proof type/magic mismatch was rejected during browser QA.
- Commands and results: typecheck passed; lint passed; tests passed 19/19; smoke passed; production build passed; npm audit reported 0 vulnerabilities. Browser QA passed at desktop and 390x844 mobile for worker login, manual 250K/$24.99 order, encrypted credentials/backup codes, $16.50 fake quote, approval, explicit confirmation checkbox, single submission, worker sync, workspace timeline, proof upload, and completion. The first deliberately mislabeled proof was rejected with HTTP 400; the correctly labeled JPEG was accepted.
- Decisions needed: no Phase 2 decision blocks Phase 3 contract implementation.
- Blockers: the disposable Docker container was stopped when Docker Desktop exited; remove the named `eldorado-codex-postgres` test container on the next Docker session. It holds sanitized test-only data. Real FUT verification still requires approved credentials/scope.
- Exact next step: map the public FUT Postman contract into the provider interface, implement public and owned-sender calls, durable unknown-result recovery, status/customer-action mapping, capacity/balance/proof checks, and sanitized contract tests without making unapproved real calls.

## 2026-08-13 - Codex - Phase 3 FUT Transfer contract implementation

- Phase / acceptance criterion: Phase 3 real FUT adapter; public/owned paths, exact-once submission safety, external-ID recovery, customer-action correction, and sanitized contract coverage.
- Summary: Replaced the generic placeholder adapter with the public FUT Transfer Postman contract. Added body authentication (`apiUser` + MD5 `apiKey`), public supplier quote/selection and purchase, owned-sender capacity/order flow, balance, status lookup by provider or external UUID, stop/resume, credential correction-and-continue, explicit documented status instructions, and an UNKNOWN recovery dashboard path. Submission mutations are never automatically retried.
- Files changed: `.env.example`, `src/lib/config.ts`, `src/lib/integrations/fut.ts`, `src/lib/orders/service.ts`, `src/lib/testing/workflow.ts`, `app/dashboard/DashboardClient.tsx`, `app/api/orders/[id]/correct/route.ts`, smoke scripts, domain/integration tests, `docs/FUT_TRANSFER_CONTRACT.md`, `docs/ACTIVE_MVP_PLAN.md`, and `docs/PHASES.md`.
- Migration/schema impact: none; Phase 1 already supplied `externalOrderId`, provider metadata, fulfillment source, and durable `FutSubmissionState.UNKNOWN`.
- Security/accounting impact: plaintext customer credentials exist only at the provider-call boundary and are never persisted in FUT events; API secrets moved to the documented body fields and production requires an MD5-shaped key; provider decimals are converted to USD cents; owned-sender internal cost is configured in cents per 100K; unknown FUT codes fail closed to manual review; timeout/network ambiguity cannot trigger an automatic second purchase.
- Commands and results: public Postman collection reviewed without sending requests; typecheck passed; lint passed with zero errors/warnings; sanitized tests passed 23/23; production build passed; smoke passed. No real FUT call was made.
- Decisions needed: owner must provide/approve low-risk test credentials and controlled order scope; confirm the true owned-sender internal cost per 100K before economic reporting; confirm whether FUT exposes a separate downloadable proof artifact (none was present in the reviewed public collection, so MVP proof remains the verified private upload).
- Blockers: Phase 3 exit cannot be claimed until approved credentials complete controlled success, failure, action-required, timeout/recovery, and leak checks. The public documentation does not identify a sandbox.
- Exact next step: proceed with Phase 4 admin/economy using sanitized/fake data, while keeping real FUT submission disabled; run `docs/FUT_TRANSFER_CONTRACT.md` controlled verification only after explicit approval.

## 2026-08-13 - Codex - Phase 4 owner control and USD economy

- Phase / acceptance criterion: Phase 4 admin/economy; owner-only operations, exact USD ledger totals, FUT controls, effective fee policy, reconciliation, payroll, and audit.
- Summary: Added a responsive owner-only control view with immutable-ledger USD components/net profit, FUT balance and UNKNOWN exceptions, unreconciled-order count, effective-dated marketplace fee updates, approval/quote/visibility controls, payroll draft-review-approve-paid workflow, audit history, CSV export, and completed-order reconciliation. Added owner-only economy/audit APIs and payroll period listing.
- Files changed: `app/dashboard/DashboardClient.tsx`, `app/globals.css`, `app/api/admin/economy/route.ts`, `app/api/admin/audit/route.ts`, `app/api/payroll/route.ts`, `src/lib/admin-economy.ts`, `src/lib/reports.ts`, `src/lib/settings.ts`, `src/lib/payroll.ts`, `src/lib/ledger.ts`, and `tests/domain.test.ts`.
- Migration/schema impact: none.
- Security/accounting impact: every admin endpoint enforces OWNER_ADMIN; audit payloads are redacted; marketplace fee changes are effective-dated rather than rewriting prior orders; reconciliation may remain USD-only without forcing an arbitrary EGP rate; payroll paid transitions are audited; worker quote visibility is validated and configurable.
- Commands and results: typecheck passed; lint passed; tests passed 24/24 including exact USD component reconciliation; production build passed with the new owner-only routes. DB-backed owner-console/browser verification remains pending because the disposable PostgreSQL environment is not currently running.
- Decisions needed: actual marketplace fee, owned-sender cost per 100K, final salary policy, and approved FUT live-test scope.
- Blockers: Phase 3 controlled real verification and Phase 4 DB/browser verification.
- Exact next step: restore a disposable local PostgreSQL environment, run DB smoke plus owner/worker authorization and owner-console browser QA, then begin Phase 5 hardening evidence.
