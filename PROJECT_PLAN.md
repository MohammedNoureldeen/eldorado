# Eldorado FC Coin Operations Platform

## Summary

Build a secure operations platform for managing Eldorado coin orders from receipt through FUT Transfer fulfillment, financial reconciliation, worker performance, payroll, and audit reporting.

The first release will use:

- Manual Eldorado order entry by workers.
- Worker-entered customer credentials.
- FUT Transfer API preparation followed by worker confirmation.
- Managed cloud hosting.
- Multi-currency accounting with EGP reporting.
- Transparent shift and activity tracking.
- Telegram operational alerts.
- Admin-approved monthly payroll calculations.
- No Eldorado automation until a permitted, stable integration method is confirmed.

Primary workflow:

`Eldorado order -> dashboard entry -> credential validation -> admin/worker review -> FUT Transfer submission -> status synchronization -> proof -> financial reconciliation -> KPI/payroll reporting`

## Architecture

- Frontend and backend: Next.js with TypeScript.
- Database: managed PostgreSQL with Prisma migrations.
- Hosting: Vercel.
- File storage: private S3-compatible object storage for delivery proof.
- Authentication: database-backed secure sessions, Argon2 password hashing, optional administrator 2FA.
- Background processing: scheduled database job queue for FUT synchronization, Telegram delivery, credential deletion, and report generation.
- Monitoring: structured application logs, error tracking, uptime checks, and integration-health dashboard.
- Environments: separate development, staging, and production databases and API credentials.
- All timestamps stored in UTC and displayed in Africa/Cairo time.

## Roles and Permissions

### Owner/Admin

- Manage workers, permissions, schedules, salary rules, API settings, and notification settings.
- Access all orders, finances, reports, audit events, and credential-reveal history.
- Assign or reassign orders.
- Approve high-risk orders and FUT submissions.
- Approve payroll and manual financial adjustments.
- Refund, cancel, reopen, or dispute orders.
- Export business and payroll reports, excluding credentials.

### Worker

- Clock in, start breaks, return, and clock out.
- Create and process assigned orders.
- Enter customer credentials.
- Reveal credentials only for assigned active orders.
- Prepare and confirm FUT Transfer submissions within configured limits.
- Upload proof and record customer communication.
- Cannot edit financial records after reconciliation.
- Cannot export credentials, modify audit logs, or approve payroll.

Every sensitive action records the user, timestamp, IP, session, order, action, and result.

## Order Lifecycle

Statuses:

1. `DRAFT`
2. `WAITING_FOR_DETAILS`
3. `READY_FOR_REVIEW`
4. `APPROVED`
5. `SUBMITTED_TO_FUT`
6. `PROCESSING`
7. `CUSTOMER_ACTION_REQUIRED`
8. `COMPLETED`
9. `FAILED`
10. `CANCELLED`
11. `DISPUTED`
12. `REFUNDED`

Rules:

- Eldorado order IDs must be unique.
- An order cannot be submitted without platform, coin quantity, sale amount, credentials, and assigned worker.
- FUT submission requires a confirmation screen showing account, platform, quantity, estimated cost, expected revenue, and estimated profit.
- Submission uses the dashboard order UUID as an idempotency key to prevent duplicate purchases.
- Completed orders require actual FUT cost and delivery proof.
- Refunds and financial corrections use ledger adjustments; historical values are never silently overwritten.
- Closed orders become read-only except through audited admin actions.
- Refunded or charged-back orders lose KPI credit in the current or next open payroll period.

## Database Design

All primary keys use UUIDs. Financial values use integer minor units and ISO currency codes, never floating-point values.

### Core tables

- `organizations`: business identity, base currency, timezone, status.
- `users`: login identity, role, status, password metadata, 2FA settings.
- `worker_profiles`: employment dates, Telegram identity, schedule, active salary policy.
- `sessions`: authenticated sessions, expiration, revocation, IP, user agent.
- `shifts`: scheduled/start/end times, breaks, connected minutes, notes, approval state.
- `shift_events`: clock-in, clock-out, break, reconnect, disconnect, and admin corrections.
- `orders`: Eldorado ID, platform, coin amount, status, assigned worker, deadlines, timestamps.
- `order_status_history`: previous/new status, actor, reason, source, timestamp.
- `customer_credentials`: encrypted email, password, backup codes, key version, deletion deadline.
- `credential_access_events`: reveal attempts, actor, reason, success, IP, timestamp.
- `fut_orders`: provider order ID, request snapshot, mapped status, submitted cost, actual cost.
- `fut_api_events`: sanitized requests, responses, status codes, retry count, correlation ID.
- `financial_entries`: revenue, marketplace fees, FUT cost, refunds, FX fees, and adjustments.
- `exchange_rates`: source currency, EGP rate, effective time, source, locked/manual state.
- `proof_files`: private storage key, type, checksum, uploader, retention date.
- `order_notes`: operational notes with author and timestamps.
- `audit_events`: immutable security and business action history.
- `notification_events`: Telegram event, recipient, delivery state, retries, error.
- `payroll_periods`: month, dates, status, approval and payment metadata.
- `payroll_entries`: worker metrics, tier, base salary, bonus, deductions, adjustments, final amount.
- `salary_policies`: thresholds, amounts, bonus interval, bonus value, effective dates.
- `settings`: approval limits, retention periods, alert thresholds, integration configuration.
- `background_jobs`: job type, payload reference, schedule, retry, lock, result.

### Financial calculation

For each order:

`Net revenue = Eldorado gross sale - marketplace fees - refunds`

`True cost = FUT actual cost + payment/FX fees + approved adjustments`

`Gross profit = net revenue - true cost`

Store original currency values, the exchange rate used, and converted EGP values. Lock the exchange rate when the transaction is reconciled.

Reports must distinguish estimated, actual, and reconciled profit.

## Credential Security

- Encrypt email, password, and backup codes independently using authenticated encryption.
- Keep encryption keys outside PostgreSQL in managed secrets, with key versioning and rotation support.
- Never include credentials in logs, analytics, Telegram, exports, URLs, or FUT event snapshots.
- Credential reveals require an active session and an assigned active order.
- Require the worker to select a reveal reason; every reveal is audited.
- Prevent browser caching and mask fields by default.
- Copy actions are logged but copied values are never captured.
- Automatically and permanently delete credentials seven days after completion, cancellation, failure, or refund.
- Admin can trigger immediate deletion.
- A daily job verifies deletion and reports failures.
- Retain non-sensitive order history and proof according to the business retention policy.
- Customer handling notices and worker policies must explain credential processing and activity logging.
- Review Eldorado, FUT Transfer, EA, privacy, and employment requirements before production use.

## FUT Transfer Integration

### Discovery gate

Before coding against the Postman collection:

- Move its secrets into a private environment.
- Rotate any credentials previously shared.
- Document base URLs, authentication, required headers, expiration, rate limits, and environments.
- Identify order creation, validation, price, balance, status, cancellation, and error endpoints.
- Confirm that server-side automation is permitted.
- Create sanitized fixtures without real customer credentials.

### Integration service

Expose internal operations:

- `prepareFutOrder(orderId)` validates data and retrieves current cost.
- `confirmFutOrder(orderId, expectedVersion)` submits after worker confirmation.
- `syncFutOrder(orderId)` retrieves the provider status and actual cost.
- `cancelFutOrder(orderId)` is available only if supported and permitted.
- `getFutBalance()` powers balance warnings.

Controls:

- Server-side API credentials only.
- Idempotency protection and database locking.
- Timeouts, bounded retries, exponential backoff, and circuit breaker.
- Explicit mapping from every FUT status/error to an internal state.
- Manual fallback when FUT Transfer is unavailable.
- Low-balance, price-change, authentication-failure, and repeated-error alerts.
- Require reconfirmation if cost changes beyond the configured tolerance.
- Store sanitized request/response metadata for troubleshooting.

## Shift Tracking and KPIs

Shift tracking is disclosed to workers and limited to business-system activity.

- Workers explicitly clock in, break, return, and clock out.
- Dashboard heartbeat records availability while the dashboard is open.
- A missing heartbeat flags disconnection; it does not automatically prove misconduct.
- Order actions and status changes provide operational activity evidence.
- Admin can correct a shift only with a reason, creating an audit event.
- No screenshots, keystroke capture, global browser tracking, or hidden surveillance.

Monthly metrics:

- Completed clean orders.
- Assigned valid orders and handling rate.
- Median acceptance and completion time.
- Failed, refunded, disputed, and worker-error rates.
- Scheduled, connected, break, and unexplained-gap time.
- Revenue, cost, and profit handled.
- Credential-policy and proof-completion compliance.

Initial salary policy:

- Fewer than 200 completed clean orders: 3,000 EGP.
- 200-249 completed clean orders: 3,500 EGP.
- 250 or more: 5,000 EGP.
- Every complete block of 10 clean orders above 250: 150 EGP bonus.
- Only completed, paid, non-refunded orders count.
- Low business demand is flagged, but the owner manually approves any protected or adjusted salary.
- Payroll remains `DRAFT` until admin approval and becomes immutable after payment; later reversals appear in the next period.

## Screens and Workflows

### Admin

- Operations overview: active orders, delays, failures, workers online, FUT balance, daily profit.
- Order queue with search, filters, assignment, aging, and priority indicators.
- Full order detail timeline covering actions, money, FUT events, proof, and credential access.
- Worker management, schedules, attendance, KPI scorecards, and payroll approval.
- Financial dashboard with revenue, costs, refunds, margin, profit, platform, worker, and period filters.
- Integration-health page showing FUT status, retries, failures, and Telegram health.
- Security audit and credential-retention report.
- Configurable salary, approval, FX, notification, and retention settings.

### Worker

- Shift controls and current availability state.
- Assigned-order queue prioritized by deadline and status.
- Guided order-creation form with duplicate detection.
- Credential entry and validation.
- FUT review/confirmation screen.
- Delivery-proof upload and completion checklist.
- Personal shift, completed-order, quality, and estimated-pay view.

## Telegram Notifications

Send configurable alerts for:

- Worker clock-in, clock-out, late start, and prolonged disconnection.
- New unassigned or overdue orders.
- FUT submission, failure, authentication problem, or excessive retry.
- Cost change above tolerance and low FUT balance.
- High-value order requiring admin approval.
- Refund, dispute, manual financial adjustment, or credential-retention failure.

Notifications contain order references and dashboard links, never customer credentials. Group repetitive alerts and apply quiet-hour rules except for critical failures.

## Reliability and Security Controls

- HTTPS only, secure cookies, CSRF protection, rate limiting, and strict security headers.
- Server-side validation for all operations.
- Row-level authorization in the service layer.
- Admin 2FA and session revocation.
- Daily encrypted database backups and documented restore procedure.
- Private proof storage using short-lived signed URLs.
- Malware/type/size checks on uploads.
- Immutable audit events and append-only financial entries.
- Automated dependency, vulnerability, error, and uptime monitoring.
- Production actions protected from staging credentials and data.
- No API secrets committed to source control.
- Quarterly credential-key rotation and access review.

## Delivery Phases

1. Foundation: architecture, environments, schema, authentication, roles, audit framework.
2. Manual MVP: shifts, workers, manual orders, credentials, statuses, proof, manual financial ledger.
3. Reporting: profit dashboards, KPI calculations, payroll drafts, exports, Telegram alerts.
4. FUT integration: Postman audit, sandbox tests, prepare/confirm workflow, polling, retries, reconciliation.
5. Hardening: security review, backup restore test, load testing, retention jobs, operational documentation.
6. Pilot: owner plus one worker, limited order volume, manual verification of every financial result.
7. Production rollout: both workers, alert tuning, weekly reconciliation, monthly payroll approval.
8. Future work: secure customer-entry links and permitted Eldorado order/status integration, including pause/unpause tracking only with transparent worker policy.

## Test Plan

- Authentication, authorization, session expiration, 2FA, and revoked-worker access.
- Complete lifecycle for PC, PlayStation, and Xbox orders.
- Duplicate Eldorado ID and duplicate FUT submission prevention.
- FUT success, timeout, malformed response, price change, low balance, authentication failure, and retry exhaustion.
- Currency conversion, fee, refund, partial refund, adjustment, and profit reconciliation.
- Salary boundaries at 199, 200, 249, 250, 259, and 260 clean orders.
- Refund reversal after payroll approval.
- Shift disconnect, break, correction, late start, and timezone behavior.
- Credential encryption, masked display, unauthorized reveal, access logging, key rotation, and seven-day deletion.
- Proof upload authorization, signed-link expiry, invalid type, and oversized file.
- Telegram delivery, retry, deduplication, and credential-redaction tests.
- Backup restoration and disaster-recovery rehearsal.
- Desktop and mobile usability tests for both roles.
- Concurrency tests for reassignment, simultaneous updates, and repeated confirmation clicks.

## Acceptance Criteria

- Every order has a complete, immutable timeline.
- Duplicate FUT purchases are prevented.
- No credential appears unencrypted in the database, logs, files, notifications, analytics, or exports.
- Credentials are deleted seven days after closure and deletion is verifiable.
- Profit can be reconciled from individual ledger entries to monthly totals.
- Payroll results exactly follow the configured policy and require admin approval.
- Workers can complete normal orders without accessing admin-only financial or security functions.
- FUT failures preserve the order safely and provide a manual recovery path.
- Backups can be restored successfully.
- The pilot completes at least 50 real orders with no unexplained financial differences before full rollout.

## Assumptions

- One business organization, one owner/admin, and initially two workers.
- EGP is the reporting and payroll currency.
- Eldorado orders are entered manually in version 1.
- Workers enter credentials received through the approved customer communication channel.
- FUT orders require human confirmation before purchase.
- The Postman collection is documentation only until its authorization and behavior are verified.
- Eldorado pause/unpause monitoring and automatic order import are outside version 1.
- Salary rules, thresholds, approval limits, and notification preferences remain configurable without code changes.
