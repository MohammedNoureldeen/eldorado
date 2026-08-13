# Hardening evidence

Recorded 2026-08-13 against disposable PostgreSQL 16.14 databases with sanitized fixtures only. No real FUT request or customer credential was used.

## Verification results

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings/errors.
- `npm test`: 25/25 passed, including fail-closed automation limits.
- `npm run build`: passed; owner automation, retention, and order automation routes are present in the production route manifest.
- `npm run hardening:smoke`: passed. Eight concurrent confirmations produced exactly one provider create; worker cross-access and owner-report access were denied correctly; seven-day deletion, v1-to-v2 encryption rotation, expired-credential deletion, shared PostgreSQL rate limiting, guarded automation activation/emergency stop, and append-only audit enforcement passed.
- `npm run load:smoke`: 100 concurrent order reads and 200 shared limiter writes passed; measured order-read p95 was 232 ms and maximum 233 ms on the local disposable environment.

## Backup/restore rehearsal

- Source database: disposable `eldorado_hardening_0813`.
- Custom PostgreSQL dump encrypted with AES-256-GCM, plaintext removed, decrypted only for isolated restore, and restored to disposable `eldorado_restore_0813`.
- SHA-256 of the dump: `FBAD29060F37E34E6B31ACFDB5D10AD9DB1AEC5E56CF3D89097B4FC69F794C0F`.
- Source and restored verification matched: 5 orders, 23 status-history rows, 3 financial entries, 38 audit events, 5 credential records, 0 payroll periods, and 3 applied migrations. Sample order timeline and deleted-credential state matched.
- Restored database migration check, database smoke, and application checks passed. Temporary plaintext and encrypted dump artifacts were removed after the rehearsal.

## Browser authorization and owner-console QA

- Owner login showed the owner control view, correct FUT balance, exact USD revenue/fee/cost/profit totals, source split, retention status, audit list, settings save, and the payroll draft/approve/paid lifecycle.
- Worker login showed only assigned operational work and no owner-control navigation.
- The worker flow had already passed desktop and 390 x 844 responsive QA through fake-provider proof/completion in Phase 2.

## Remaining gates

- Repeat backup/storage/monitoring checks in the selected managed staging environment.
- Complete the controlled live FUT success/failure/UNKNOWN checklist with owner-approved credentials and scope.
- Complete 50 manually confirmed real orders with no unexplained financial difference, credential exposure, duplicate provider order, or missing audit event.
- Keep automation stopped until those gates and written owner sign-off are complete.
