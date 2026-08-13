# Eldorado Operations Platform - Active MVP Plan

Last updated: 2026-08-13

Status: Phases 0-4 are implemented and verified with sanitized data. Phase 3 controlled live FUT verification and the Phase 5 fifty-order real pilot remain externally gated. Phase 5 hardening evidence and the fail-closed Phase 6 automation foundation are implemented; automation remains stopped by default.

This document is the active source of truth for the next implementation cycle. It supersedes conflicting assumptions in older documents. Security invariants in `AGENTS.md` remain mandatory.

## 1. Product outcome

Build a private operations application for one owner/admin and two workers. Workers manually enter Eldorado customer orders, securely store EA credentials, choose fulfillment, review a live FUT Transfer quote, explicitly confirm submission, track delivery, resolve customer-action problems, attach proof, and close the order. The admin tests first, then supervises workers, integrations, economy, exceptions, reconciliation, payroll, and audit.

```text
Customer name + EA login + backup codes + platform + 200K-or-more coins + USD sale
-> choose public FUT supplier or owned sender accounts
-> fetch current quote/capacity
-> worker reviews and confirms
-> submit once
-> synchronize status and customer actions
-> obtain proof
-> reconcile final USD profit
```

## 2. Locked product decisions

- This is an internal application, not a public marketing site.
- The active project lives under `D:\eldorado-main\eldorado-main`.
- Workers manually enter and process their own assigned Eldorado orders.
- A reliable Eldorado order ID may not exist. Generate an immutable reference such as `ELD-2026-000142`; keep marketplace reference optional.
- Inputs: customer name, PS/XB/PC platform, coin quantity, gross Eldorado USD sale, EA email/password, and at least one backup code.
- Minimum order quantity is 200K coins.
- Fulfillment is hybrid: FUT public suppliers or the business's owned sender accounts. The worker selects it for MVP.
- MVP requires explicit human confirmation immediately before FUT submission.
- Use one submission engine so policy-based automation can be enabled later without a rewrite.
- Sales, FUT costs, marketplace fees, and profit use USD integer cents.
- Eldorado fee starts at 5% but is an effective-dated admin setting, not hard-coded business logic.
- Do not convert every order to EGP. Payroll may remain EGP and is separate; final salary policy is open.
- Workers see only assigned operational work. Company-wide economy, balances, payroll, settings, audit, and worker management are admin-only.
- Launch default: workers see the current per-order FUT quote required for confirmation; broader financial visibility is disabled and configurable.
- Branding is deferred. Use a restrained responsive operations UI centered on the live order lifecycle.

## 3. Roles and permissions

### Worker

Allowed:

- Manage their own shift.
- Create an order assigned to themselves.
- Enter/update customer details before submission.
- Choose public-supplier or owned-sender fulfillment.
- Request a live quote/capacity check and explicitly confirm submission.
- View/work only assigned orders.
- Follow mapped FUT status and customer-action guidance.
- Correct credentials and retry when permitted.
- Stop/resume an assigned active order when policy permits.
- Add notes, upload/view proof, complete the checklist, and view own counts.

Forbidden:

- Other workers' orders or performance.
- Aggregate revenue, profit, margin, FUT balance, payroll, or reports.
- FUT secrets, settings, fee/automation/risk policies.
- Reconciliation, financial adjustments, refunds, or payroll approval.
- Security audit, user management, or session management.

### Owner/admin

- All order visibility and audited overrides.
- Worker/session management.
- FUT configuration and health.
- Fee, fulfillment, risk, quote visibility, approval, retention, and future automation policies.
- Economy, reconciliation, adjustments, refunds, reports, payroll, audit, and retention review.

## 4. Screen map

### Worker

1. **My Work** - needs action, in progress, waiting on customer, completed today, shift controls.
2. **New Order** - customer name, platform, minimum 200K quantity, gross USD sale, EA credentials, fulfillment source, optional marketplace reference/notes.
3. **Prepare Fulfillment** - public suppliers/stock/prices/tool fee, or owned stock/capacity/sender group; quote timestamp/freshness.
4. **Confirm FUT Purchase** - generated reference, masked customer, platform, quantity, source, method, risk, quote, and warnings; fresh quote plus explicit confirmation required.
5. **Order Workspace** - lifecycle rail, current action, mapped provider status, notes, proof, and safe recovery controls.

### Admin

1. **Operations** - all orders, failures, aging, worker availability, provider health.
2. **Economy** - USD gross sales, fees, quoted/final FUT costs, refunds, expected/actual/reconciled profit and margin.
3. **Orders** - search, filters, reassignment, exceptions, immutable timeline.
4. **FUT Control** - connection health, supplier conditions, owned stock, cooldown/failures, future automation.
5. **Workers** - accounts, sessions, shifts, KPI inputs.
6. **Payroll** - EGP policy and draft/approve/paid lifecycle.
7. **Security/Audit** - credential access, retention, sessions, immutable audit events.
8. **Settings** - fee rules, quote visibility, approvals, defaults, risk, retention, Telegram, automation.

## 5. Data model changes

Use additive migrations; never rewrite the initial migration.

### Order

- Generated unique immutable `orderReference`.
- Optional marketplace reference.
- Customer name.
- Documented canonical coin unit.
- USD sale default/validation.
- Fulfillment source enum: `PUBLIC_SUPPLIER`, `OWNED_SENDERS`.
- Preparation/confirmation and transfer/risk metadata.

### FUT order

- Provider order ID and mother-order ID separately.
- Internal UUID as provider `externalOrderID` where allowed.
- Source, supplier ID/hash, public/private flag, sender group, transfer method, risk.
- Quoted/final cost, currency, quote/submission/sync timestamps.
- Never store credentials, backup codes, `apiUser`, or `apiKey` in snapshots/events.

### Finance/settings

- USD integer cents for order economy.
- Effective-dated marketplace fee; default 500 basis points.
- Separate estimated, actual, and reconciled values.
- Payroll independently configurable.
- Settings for worker quote visibility, source default, tolerance, confirmation limit, future automation mode.

### Duplicate protection

- Immutable generated reference.
- Optional marketplace reference unique only when supplied.
- Short-lived warning based on organization, normalized customer fingerprint, platform, quantity, sale amount, and time window.
- Never fingerprint/store plaintext passwords or backup codes.

## 6. FUT Transfer API contract

Public documentation reviewed 2026-08-13: `https://www.postman.com/futtransfer/fut-transfer/overview`.

### Authentication

- Public collection base URL: `https://futtransfer.top`.
- `apiUser` and an MD5 API-key value are sent in JSON bodies.
- Both remain server-side and never appear in logs, events, errors, fixtures, telemetry, or exports.
- No clear sandbox was visible. Do not send real requests until test credentials or a tightly controlled production-test scope is owner-approved.

### Public-supplier path

1. `POST /buyConditionAPI` - supplier stock/prices/tool fee/balance; platform, amount K, max price, average, full-price filters.
2. `POST /buyCoinsAPI` - manual selected-supplier purchase after confirmation; credentials, platform, amount K, supplier, `externalOrderID`, max price, method/risk.
3. Future `POST /buyCoinsAutoAPI` - provider auto-selection; disabled in MVP.

Documented customer-account limits: 3 orders/minute, 10/5 minutes, 30/30 minutes.

### Owned-sender path

1. `POST /availableStockAPI` - capacity.
2. `POST /orderAPI` - owned-sender transfer after confirmation; credentials, platform, amount K, sender group, method/risk, `externalOrderID`.

### Tracking/recovery

- `POST /orderStatusAPI` by provider, external, or mother-order ID.
- `POST /correctCredentialsAPI` for correction and optional retry.
- `POST /resumeOrderAPI` for resume/stop.
- Provider screenshot/proof endpoint.
- Add bulk status, cooldown, edit, and finish only when required by mapped workflow.

Create an explicit mapping for every documented `status`, `accountCheck`, and `economyState`: internal state, worker instruction, customer-action flag, safe recovery, terminal flag, retention behavior, and severity. Unknown states enter admin review; never silently map them to normal processing.

## 7. Financial model

```text
net revenue = gross Eldorado USD sale - marketplace fee - refunds
true cost = final FUT USD cost + processing fees + approved adjustments
profit = net revenue - true cost
margin bps = profit / net revenue * 10,000
```

- Use integer USD cents and basis points; never floats.
- Worker enters gross price before fees.
- Initial 5% fee is prospective/configurable and must be confirmed before production.
- Quote is estimated; provider final cost is actual; reconciliation locks the ledger.
- Preserve USD. Any future EGP management report uses an approved locked rate without replacing original USD.

## 8. Security/reliability

- Preserve AES-256-GCM field encryption and key versions.
- Decrypt credentials only in server memory immediately before an authorized provider call.
- Never store full provider request bodies.
- Use durable submission states: `PREPARED -> CONFIRMING -> SUBMITTED/UNKNOWN/FAILED`.
- Timeout after submission becomes `UNKNOWN`; query by `externalOrderID` before retry.
- Use DB locking, optimistic versioning, and internal UUID to prevent duplicates.
- Every terminal provider path schedules seven-day credential deletion.
- Refund, status, ledger, and KPI reversal are transactional.
- Reclaim stale `RUNNING` jobs and claim notifications before delivery.
- Fail production startup on missing/weak required secrets.
- Preserve manual recovery after automation exists.

## 9. Implementation phases

### Phase 0 - Baseline and safety repairs

- Repair deterministic install/lockfile behavior.
- Fix refund atomicity and terminal credential retention.
- Fix payroll handling-rate inputs.
- Add stale job recovery and notification claiming.
- Enforce production configuration.
- Add regression tests.

Exit: clean install, lint, typecheck, tests, smoke, build; DB smoke when PostgreSQL is configured.

### Phase 1 - Schema/domain

- Generated references, optional marketplace reference, customer name, source, USD policies, quote/provider metadata.
- Add migration, sanitized fixtures, services, tests.

Exit: both sources represented without provider calls.

### Phase 2 - Worker MVP

- My Work, New Order, Prepare, Confirm, Order Workspace.
- Strict role scoping and responsive layouts.

Exit: worker completes fake-provider end-to-end flow.

### Phase 3 - Real FUT adapter

- Public conditions/purchase, owned stock/order, status, correction, stop/resume, proof, rate limits, unknown-result recovery.
- Sanitized contract fixtures only.

Exit: approved test credentials complete success/failure cases with no leaks/duplicates.

### Phase 4 - Admin/economy

- Operations, USD economy, FUT control, settings, reconciliation, payroll, audit.

Exit: ledger reconciles exactly to dashboard totals.

Status: completed with PostgreSQL and owner/worker browser verification on 2026-08-13.

### Phase 5 - Hardening/pilot

- Concurrency, load, backup, key rotation, credential deletion, proof, rate-limit, responsive/security QA.
- Admin tests first; then one worker at limited volume.

Exit: 50 manually confirmed real orders with no unexplained difference, exposure, or duplicate.

Status: engineering hardening completed with sanitized concurrency, load, encrypted backup/restore, retention, key rotation, shared rate-limit, role-isolation, browser, and production-build evidence. The 50-order real pilot is not complete.

### Phase 6 - Controlled automation

- `MANUAL`, `LIMIT_BASED`, `AUTOMATIC` using the same service; default manual.
- Stop on stale quote, price change, low balance/capacity, missing credentials, unknown response, cooldown, risk violation, repeated failure.
- Requires admin activation, audit, kill switch, rollback.

Status: guarded foundation implemented. Default policy is `MANUAL` with the kill switch active. Non-manual activation requires an owner-only protected API, the exact acknowledgement phrase, explicit limits, platforms, and fulfillment sources. Real activation remains gated on the manual pilot and owner sign-off.

## 10. Acceptance matrix

- Worker/admin authorization for every screen/service.
- PS/XB/PC and 200K boundary.
- Both fulfillment sources.
- Quote refresh/tolerance, insufficient balance/stock, no supplier.
- Wrong password/backup code, CAPTCHA, console login, wrong platform/persona, full transfer list, insufficient customer coins, cooldown, unknown state.
- Duplicate clicks, concurrent confirmation, timeouts before/after acceptance, lookup by external ID.
- Encryption, no-cache, redaction, reveal audit, seven-day deletion on every terminal path.
- USD fee boundaries, refunds/partial refunds, adjustments, reconciliation.
- Worker isolation and hidden admin economy.
- Job lease recovery and notification deduplication.
- Desktop/mobile worker flows.

Acceptance gates:

- No provider call without fresh quote/capacity and explicit MVP confirmation.
- No credential/API secret in DB events, logs, errors, proof metadata, Telegram, analytics, fixtures, exports.
- Timeout cannot cause automatic duplicate purchase.
- Every order has immutable timeline/reference.
- USD ledger reproduces order/period totals exactly.
- Workers cannot access other orders or admin economy/security.
- Every terminal state schedules deletion within seven days.
- Verification evidence is recorded in `docs/WORK_LOG.md`.

## 11. Open decisions

- Final EGP salary tiers/bonuses.
- Whether workers see per-order FUT quote after pilot.
- Owned-sender groups and default method/risk.
- FUT test credentials and permitted test-call scope.
- Hosting/database/storage/monitoring/backup providers.
- Telegram recipients/thresholds.

Resolve these in `docs/DECISIONS.md`; do not guess them in code.

## 12. Definition of done per task

- Read `AGENTS.md`, this plan, `DECISIONS.md`, and `WORK_LOG.md`.
- Link work to a phase/acceptance criterion.
- Preserve invariants and add/update tests.
- Run applicable verification.
- Update `WORK_LOG.md` with files, migrations, impacts, tests, blockers, next step.
- Update this plan and `PHASES.md` if scope/status changes.
- Never leave undocumented behavior or changed assumptions.
