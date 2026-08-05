# Eldorado Operations Platform

Eldorado is a secure internal operations platform for managing manual coin-order fulfillment from intake through reconciliation and payroll.

The platform keeps provider actions human-confirmed. It does **not** automatically import Eldorado orders or place provider orders; those capabilities require an approved provider contract and operational sign-off.

## Core workflow

```text
Order intake → assignment → credential validation → price/prepare
→ worker confirmation → status sync → proof → reconciliation → reporting/payroll
```

## Features

- Manual order intake with duplicate-order protection and a controlled status state machine.
- Role-based access for administrators and workers, organization isolation, sessions, CSRF protection, and rate limiting.
- Encrypted customer credentials with masked-by-default views, reason-required reveals, audit events, and scheduled deletion.
- Human-confirmed FUT preparation and submission with idempotency, optimistic concurrency, retries, timeouts, and circuit-breaker behavior.
- Private proof uploads with type, magic-byte, size, checksum, and signed-URL validation.
- Append-only audit and financial records, fixed-point exchange-rate calculations, refunds, reconciliation, and CSV exports without credentials.
- Worker shifts, heartbeat events, KPI reporting, configurable salary policies, payroll approval, and Telegram notifications.
- Scheduled maintenance jobs, health checks, operational smoke tests, and PostgreSQL-backed persistence.

## Tech stack

- **Web app:** Next.js 14 App Router, React 18, TypeScript
- **Database:** PostgreSQL with Prisma ORM and migrations
- **Authentication:** Argon2id password hashing, secure sessions, optional administrator TOTP
- **Storage:** S3-compatible private object storage for proof files
- **Deployment:** Vercel-compatible configuration with a scheduled jobs endpoint

## Requirements

- Node.js 20 or newer
- PostgreSQL 15 or newer
- An S3-compatible bucket for proof files when proof storage is enabled
- Approved provider and Telegram credentials for live integrations

## Local setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Create the local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set at least `DATABASE_URL`, `SESSION_COOKIE_SECRET`, and `CREDENTIAL_ENCRYPTION_KEYS` in `.env`. Use long random values and never commit `.env`.

4. Generate Prisma Client, apply migrations, and seed disposable local users:

   ```powershell
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

   Set the `SEED_*` variables before seeding. Seed credentials are for local development only.

5. Start the development server:

   ```powershell
   npm run dev
   ```

   Open `http://localhost:3000`.

## Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js server |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Run Next.js linting |
| `npm test` | Run the application tests |
| `npm run smoke` | Run provider-independent workflow smoke tests |
| `npm run db:smoke` | Exercise the workflow against PostgreSQL |
| `npm run build` | Generate Prisma Client and create a production build |

Run the full local verification set with:

```powershell
npm run typecheck
npm run lint
npm test
npm run smoke
npm run db:smoke
npm run build
```

## Configuration

`.env.example` documents the complete configuration surface, including:

- PostgreSQL and session settings.
- Versioned AES-256-GCM credential-encryption keys.
- FUT adapter settings, retry limits, timeout, and price tolerance.
- Telegram notification settings.
- S3-compatible proof storage and signed URL settings.
- Optional malware scanning and Sentry reporting.
- The protected maintenance-job token and local seed credentials.

Provider paths in the FUT adapter are intentionally generic placeholders. Do not connect them to a real provider until the discovery gate in [`docs/OPERATIONS.md`](docs/OPERATIONS.md) is complete.

## API areas

The App Router exposes endpoints for:

- Authentication and administrator 2FA.
- Orders, credentials, notes, status, preparation, confirmation, synchronization, proof, and reconciliation.
- Shifts and shift events.
- Payroll and reports.
- Settings, workers, session revocation, health checks, and scheduled jobs.

All mutating browser requests must pass CSRF validation. Provider secrets are server-side only.

## Security boundaries

- Never commit `.env`, credentials, tokens, provider responses, or real customer data.
- Customer credentials are encrypted field-by-field and are never returned by order list/detail APIs.
- Credential reveals require authorization, a reason, and an audit event.
- Financial and audit history is append-only at the database layer; corrections are new entries with an actor and reason.
- Telegram messages and exports contain operational references and financial summaries, not customer credentials.
- Proof objects remain private and are exposed only through short-lived signed URLs.
- Use separate databases and secrets for development, staging, and production.

Before production, complete the backup/restore, dependency scanning, load/concurrency, provider discovery, and security-review gates in [`docs/OPERATIONS.md`](docs/OPERATIONS.md) and [`docs/SECURITY.md`](docs/SECURITY.md).

## Documentation

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — product scope and implementation plan
- [`docs/PHASES.md`](docs/PHASES.md) — delivery phases and external gates
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — operations runbook and rollout checklist
- [`docs/SECURITY.md`](docs/SECURITY.md) — security controls and incident response

## License

This repository is private application code. Add a project-specific license before distributing it outside the owning organization.
