# Operations runbook

## FUT discovery gate

Do not point the adapter at a real provider until all items below are signed off by the owner:

- Move any Postman secrets into a private environment and rotate every previously shared credential.
- Record the approved base URL, authentication scheme, required headers, token expiry, rate limits, sandbox/production separation, and support contact.
- Map the provider's price, balance, create, status, cancellation, and error responses to the internal adapter. Unknown statuses fail closed to `CUSTOMER_ACTION_REQUIRED`/admin review and must never be treated as normal processing.
- Confirm server-side automation and human-confirmed purchases are permitted by the provider and relevant game/platform rules.
- Replace real customer credentials with sanitized fixtures. Credentials must never appear in fixtures, request snapshots, logs, Telegram messages, exports, or analytics.
- Run success, timeout, malformed response, price-change, low-balance, authentication-failure, and retry-exhaustion tests in sandbox.

Set only placeholders in `.env`; production secrets belong in the hosting provider's encrypted secret store.

## Daily

- Check `/api/health` and the integration-health dashboard/hosting logs.
- Run or verify the scheduled `/api/jobs/run` invocation. Review failed jobs, Telegram failures, FUT authentication failures, and credential-retention failures.
- Review overdue, `CUSTOMER_ACTION_REQUIRED`, `FAILED`, and unassigned orders.
- Reconcile each completed order's actual FUT cost and proof before marking it complete.
- Confirm no credential reveal was unexpected by reviewing the audit report.

## Weekly

- Reconcile order-level ledger totals to the business payment/FUT statements.
- Review worker shifts, unexplained gaps, late starts, and admin corrections with the worker.
- Review low-balance and repeated-provider-error thresholds.
- Verify the latest database backup exists and is encrypted.

## Monthly payroll

1. Build the payroll draft for the UTC month using the configured salary policy.
2. Review completed clean orders, refunds, disputes, deductions, and adjustment rows.
3. An owner/admin approves the draft through the dashboard; only then may it be marked paid.
4. If an order is refunded after approval/payment, keep the prior period immutable. The refund workflow creates a next-period KPI reversal adjustment.
5. Export the approved payroll report and retain the approval audit event.

## Backup and restore rehearsal

Use a disposable staging database, never production:

1. Take an encrypted PostgreSQL backup using the managed provider's documented command.
2. Restore it into an isolated database with a new credential set and no production integrations.
3. Run `npm run db:migrate`, `npm run db:seed` only if the rehearsal requires seed data, then `npm run typecheck`, `npm test`, and `npm run build`.
4. Verify an order timeline, ledger reconciliation, payroll draft, audit events, and credential deletion state.
5. Record restore start/end time, row counts, missing objects, and the owner sign-off. Repeat at least quarterly.

Repository helpers: `npm run backup:crypto -- encrypt|decrypt ...` performs AES-256-GCM envelope encryption; `npm run backup:verify` records migration/table/sample invariants after restore. Never leave a plaintext dump on disk after validation. See `docs/HARDENING_EVIDENCE.md` for the sanitized rehearsal.

## Controlled automation gate

- Keep `MANUAL` mode and the kill switch active throughout the manual pilot.
- Before any activation, verify the live FUT contract, set explicit USD/coin/margin/balance/risk/failure/quote-age limits and allowed platforms/sources, and obtain written owner approval.
- Activation requires the exact phrase `ENABLE CONTROLLED AUTOMATION` through the owner-only policy endpoint; it is audit logged.
- Start with one prepared approved order. Watch provider balance, audit events, status history, and reconciliation before widening the limit.
- Use the owner emergency stop immediately for a stale/changed quote, low balance/capacity, missing credentials, UNKNOWN response, cooldown, risk violation, repeated failure, unexplained financial difference, or duplicate suspicion. Manual recovery remains available.

## Pilot gate

- Use one owner and one worker with production-like but limited volume.
- Manually verify every order's sale, provider cost, fees, FX rate, proof, and ledger result.
- Keep provider confirmation in the dashboard; no unattended purchase is enabled.
- Stop the pilot for any unexplained financial difference, credential exposure, duplicate provider order, or missing audit event.
- Continue until at least 50 real orders complete with no unexplained financial difference; then record the owner approval for rollout.

## Production rollout and rollback

- Deploy with separate production database and credentials. Run migrations before enabling traffic.
- Seed or invite users through the admin workflow; force strong passwords and enable admin 2FA.
- Start with conservative FUT limits, low-balance alerts, and quiet hours; tune only after observed traffic.
- Reconcile daily during the first week and weekly thereafter. Approve payroll monthly.
- To stop safely, disable new order assignment and FUT confirmation, keep status sync/reconciliation available, and use the manual provider recovery path. Do not delete rows or rewrite financial history.

## Incident contacts and evidence

Record incident time, affected order IDs (never credentials), user/session IDs, correlation IDs, provider response status, audit event IDs, and remediation. Rotate the affected secret immediately, revoke sessions, preserve logs, and follow [`SECURITY.md`](SECURITY.md).
