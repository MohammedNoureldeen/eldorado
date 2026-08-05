# Delivery phase map

| Phase | Delivered in this repository | External gate |
| --- | --- | --- |
| Foundation | Next.js/TypeScript app, PostgreSQL Prisma schema/migration, UTC timestamps, Cairo display defaults, sessions, Argon2, optional admin TOTP, RBAC, CSRF, headers, rate limiting, audit triggers, environment separation | Provision separate development, staging, and production projects/secrets |
| Manual MVP | Manual order entry, duplicate Eldorado ID constraint, state machine, assignment, encrypted credentials, reveal audit, seven-day deletion fields/job, proof validation/private storage URLs, notes/status history, shifts/heartbeats | Train owner and worker; publish credential/customer notices |
| Reporting | Immutable financial entries, fixed-point FX conversion, reconciliation, CSV export without credentials, summary report, KPI inputs, configurable salary policy, draft/approve/paid payroll, refund reversal adjustments, Telegram queue | Configure business-approved fee/FX rules and recipients |
| FUT integration | Sanitized HTTP adapter, server-side credentials, price/prepare, human confirmation, UUID idempotency, optimistic concurrency, retries/backoff, circuit breaker, status mapping, cancel, balance, sync jobs, API metadata | Complete [`docs/OPERATIONS.md`](OPERATIONS.md) discovery gate with permitted provider documentation and sandbox fixtures |
| Hardening | Secure cookies, CSRF, security headers, upload type/magic/size/checksum validation, append-only DB triggers, retention worker, retry queues, health endpoint, cron hook, smoke/tests/build | Run dependency scanning, backup restore, load/concurrency tests, and security review in staging |
| Pilot | Role-aware dashboard, pilot checklist, worker/admin workflows, manual recovery path | Owner + one worker complete at least 50 real orders with no unexplained financial difference |
| Production rollout | Seeded roles, deployment commands, cron configuration, reports, payroll approval, alert queue, rollout checklist | Start with both workers, tune alerts, reconcile weekly, approve payroll monthly |
| Future work | No automatic Eldorado import or pause/unpause automation is enabled | Add only after written permission, stable contract, and transparent worker policy |
