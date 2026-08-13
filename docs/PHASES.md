# Delivery phase map

## Active MVP v2 phase map

Detailed source of truth: [`ACTIVE_MVP_PLAN.md`](ACTIVE_MVP_PLAN.md). Record evidence and handoff in [`WORK_LOG.md`](WORK_LOG.md).

| Phase | Scope | Status | Exit evidence |
| --- | --- | --- | --- |
| 0. Baseline/safety | Install, refund atomicity, retention, payroll inputs, stale jobs, production config | Completed 2026-08-13 | Tests, smoke/type/lint/build clean and npm audit 0; later PostgreSQL smoke also passed |
| 1. Schema/domain | Generated references, optional marketplace reference, customer, hybrid source, USD policies, provider metadata | Completed 2026-08-13 | Additive migration verified fresh and over legacy data; DB smoke; 19/19 tests; both source fixtures |
| 2. Worker MVP | My Work, New Order, Prepare, Confirm, Workspace, role scoping | Completed 2026-08-13 | Desktop + 390x844 fake-provider browser flow through proof/completion; 19/19 tests; clean build |
| 3. Real FUT adapter | Public buy, owned transfer, status, recovery, proof, limits, unknown-result safety | Contract implementation complete; controlled live verification blocked by approved credentials/scope | 23/23 sanitized tests and clean type/lint/build; controlled success/failure verification still required |
| 4. Admin/economy | Operations, USD economy, FUT control, settings, reconciliation, payroll, audit | Completed 2026-08-13 | PostgreSQL reconciliation, payroll lifecycle, owner/worker browser authorization, responsive owner console, clean build |
| 5. Hardening/pilot | Concurrency, backup, deletion, responsive/security QA, owner then worker pilot | Engineering evidence complete; real pilot externally blocked | Sanitized concurrency/load, encrypted backup/restore, key rotation/deletion, shared limits, immutable audit and browser QA pass; 50 real manual orders still required |
| 6. Automation | Manual/limit/automatic policies, kill switch, alerts, rollback | Fail-closed foundation complete; activation gated | Manual + kill-switch default, exact owner acknowledgement, explicit limits, evaluated stop reasons, audit, emergency stop; owner sign-off and real pilot required |

| Phase | Delivered in this repository | External gate |
| --- | --- | --- |
| Foundation | Next.js/TypeScript app, PostgreSQL Prisma schema/migration, UTC timestamps, Cairo display defaults, sessions, Argon2, optional admin TOTP, RBAC, CSRF, headers, rate limiting, audit triggers, environment separation | Provision separate development, staging, and production projects/secrets |
| Manual MVP | Manual order entry, duplicate Eldorado ID constraint, state machine, assignment, encrypted credentials, reveal audit, seven-day deletion fields/job, proof validation/private storage URLs, notes/status history, shifts/heartbeats | Train owner and worker; publish credential/customer notices |
| Reporting | Immutable financial entries, fixed-point FX conversion, reconciliation, CSV export without credentials, summary report, KPI inputs, configurable salary policy, draft/approve/paid payroll, refund reversal adjustments, Telegram queue | Configure business-approved fee/FX rules and recipients |
| FUT integration | Public Postman contract adapter, body authentication, public supplier selection, owned-stock capacity, single-shot submission, external-UUID recovery, credential correction/resume, documented status instructions, cancel, balance, sanitized API metadata | Run the controlled checklist in [`docs/FUT_TRANSFER_CONTRACT.md`](FUT_TRANSFER_CONTRACT.md) with approved test credentials/scope |
| Hardening | Secure cookies, CSRF, CSP/HSTS/no-store headers, upload validation, append-only DB triggers, retention and key-rotation controls, shared PostgreSQL login limits, encrypted backup/restore tools, concurrency/load smoke, health/cron | Repeat the recorded rehearsal in the chosen managed staging environment and add continuous monitoring |
| Pilot | Role-aware dashboard, pilot checklist, worker/admin workflows, manual recovery path | Owner + one worker complete at least 50 real orders with no unexplained financial difference |
| Production rollout | Seeded roles, deployment commands, cron configuration, reports, payroll approval, alert queue, rollout checklist | Start with both workers, tune alerts, reconcile weekly, approve payroll monthly |
| Controlled automation | No automatic Eldorado import. FUT automation code is present but stopped by the default manual policy and kill switch | Activate only after written owner permission, stable live contract, successful manual pilot, explicit limits, and transparent worker policy |
