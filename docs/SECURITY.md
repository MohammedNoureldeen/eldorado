# Security controls

## Access

- Sessions are random opaque tokens stored as HMAC hashes with expiration, revocation, IP, and user-agent metadata.
- Mutating browser requests require a double-submit CSRF token. Cookies are `HttpOnly`, `Secure` in production, `SameSite=Strict`, and `no-store` is used for credential responses.
- Passwords use Argon2id. Administrator TOTP uses an encrypted secret and ±1 time-step verification.
- Service-layer checks enforce organization and role boundaries. Workers only access assigned active orders; administrators can manage all business records.

## Credential handling

- Email, password, and backup codes are encrypted independently with AES-256-GCM. `CREDENTIAL_ENCRYPTION_KEYS` supports versioned keys; set a new active version before rotating old data.
- The database stores ciphertext, nonce, authentication tag, and key version in the packed value; encryption keys stay in the hosting secret manager.
- Credentials are masked by default, reveal requires a reason, copy/reveal actions are audited, and values are never returned from order list/detail APIs.
- Closure sets a seven-day deletion deadline. The maintenance job permanently nulls ciphertext fields and records the deletion result. Administrators can trigger immediate deletion with `DELETE /api/orders/:id/credentials`.
- The owner retention report exposes active, upcoming, overdue, failed, deleted, and legacy-key counts without exposing plaintext. Key rotation is batched, optimistic, and audited per credential set.

## Data boundaries

- Audit and financial tables have database triggers that reject update/delete. Corrections are new rows with a reason and actor.
- `redactSensitive` removes password, secret, token, API-key, and authorization fields from stored provider metadata and logs.
- Telegram payloads and CSV exports contain order references and financial summaries only.
- Proof objects are private, type/magic/size/checksum validated, encrypted at rest by the S3-compatible provider, and served through short-lived signed URLs.

## Integrations

- FUT and Telegram credentials are read only from environment variables. No provider secret is accepted from the browser.
- FUT submission uses the order UUID as `externalOrderID`, optimistic version checks, a durable `CONFIRMING` claim, no automatic mutation retries, timeouts, and fail-closed UNKNOWN recovery by external ID.
- Login limits use an atomic PostgreSQL bucket so multiple application instances share enforcement. The FUT adapter circuit breaker remains process-local and is only an additional safety mechanism.
- Controlled automation defaults to `MANUAL` with the kill switch active. Enabling requires an owner session, CSRF, exact acknowledgement, explicit limits/platforms/sources, and produces audit events. Stale/missing quotes, low balance, missing credentials, unknown submission, cooldown, excessive risk, repeated failures, margin/size/source violations, and the kill switch block execution.
- Use separate secrets and databases per environment. Never copy production credentials into Postman collections, fixtures, test output, or staging.

## Operational limitations to close before scale

- The FUT circuit breaker is process-local; correctness does not depend on it because submission is claimed in PostgreSQL. If global provider throttling is required at scale, move circuit-breaker state to shared storage.
- S3-compatible signed URLs depend on the configured endpoint's signature compatibility; test upload/download/expiry in staging.
- The adapter matches the public FUT Transfer Postman collection reviewed on 2026-08-13. The public documentation exposes no sandbox, so controlled live success/failure verification is still required before production use.
- Production must add automated dependency/vulnerability monitoring, error tracking, uptime checks, malware scanning, and a documented managed-backup restore SLA.

## Rotation and incident response

1. Revoke compromised sessions and provider tokens.
2. Create a new credential-encryption key version and set `CREDENTIAL_ACTIVE_KEY_VERSION`; run the owner credential-rotation control, verify the retention report reports zero legacy rows, then retire the old key.
3. Rotate FUT, Telegram, storage, database, and hosting secrets independently.
4. Search audit events by user/order/correlation ID, confirm no credential-bearing logs or notifications, and preserve evidence.
5. Notify affected parties and complete owner/security review. Perform key/access review at least quarterly.
