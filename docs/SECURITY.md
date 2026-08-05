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

## Data boundaries

- Audit and financial tables have database triggers that reject update/delete. Corrections are new rows with a reason and actor.
- `redactSensitive` removes password, secret, token, API-key, and authorization fields from stored provider metadata and logs.
- Telegram payloads and CSV exports contain order references and financial summaries only.
- Proof objects are private, type/magic/size/checksum validated, encrypted at rest by the S3-compatible provider, and served through short-lived signed URLs.

## Integrations

- FUT and Telegram credentials are read only from environment variables. No provider secret is accepted from the browser.
- FUT create calls use the dashboard order UUID as the idempotency key, optimistic version checks, bounded retries, timeouts, and a circuit breaker. A provider failure leaves an auditable manual recovery state.
- Use separate secrets and databases per environment. Never copy production credentials into Postman collections, fixtures, test output, or staging.

## Operational limitations to close before scale

- Rate limiting and the FUT circuit breaker are process-local. Before running multiple instances, move both to a shared Redis/database-backed store and add a distributed lock test.
- S3-compatible signed URLs depend on the configured endpoint's signature compatibility; test upload/download/expiry in staging.
- The generic FUT endpoint paths are placeholders until the provider contract passes the discovery gate.
- Production must add automated dependency/vulnerability monitoring, error tracking, uptime checks, malware scanning, and a documented managed-backup restore SLA.

## Rotation and incident response

1. Revoke compromised sessions and provider tokens.
2. Create a new credential-encryption key version and set `CREDENTIAL_ACTIVE_KEY_VERSION`; re-encrypt retained credentials through a controlled migration before retiring the old key.
3. Rotate FUT, Telegram, storage, database, and hosting secrets independently.
4. Search audit events by user/order/correlation ID, confirm no credential-bearing logs or notifications, and preserve evidence.
5. Notify affected parties and complete owner/security review. Perform key/access review at least quarterly.
