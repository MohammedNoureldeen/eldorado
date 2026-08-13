# FUT Transfer Contract Boundary

Source reviewed: public [FUT Transfer Postman collection](https://www.postman.com/futtransfer/fut-transfer/overview), collection `37015796-234ac47a-38d0-4dcb-9e5b-2e91c92ac786`.

Status: implemented against the public contract; real-network verification is blocked until the owner supplies approved test credentials and authorizes a controlled order. The public documentation does not identify a sandbox.

## Authentication and secrets

- Every request is server-to-server JSON with `apiUser` and the required 32-character MD5 `apiKey` in the request body.
- Runtime configuration uses `FUT_API_USER` and `FUT_API_KEY_MD5`. The plaintext API key must not be stored.
- Customer email, password, and backup codes are decrypted only immediately before a submission/correction call.
- Request bodies and response values are never persisted. FUT events retain only endpoint, HTTP status, field names, correlation ID, sanitized business status, and retry metadata.

## Implemented endpoint map

| Operation | Public supplier | Owned senders |
|---|---|---|
| Quote/capacity | `POST /buyConditionAPI` | `POST /availableStockAPI` |
| Submit | `POST /buyCoinsAPI` | `POST /orderAPI` |
| Status/recovery | `POST /orderStatusAPI` | `POST /orderStatusAPI` |
| Correct credentials and continue | `POST /correctCredentialsAPI` | `POST /correctCredentialsAPI` |
| Stop/resume | `POST /resumeOrderAPI` | `POST /resumeOrderAPI` |
| Balance | `POST /buyConditionAPI` (`balance`) | n/a |

Application platform mapping is `PLAYSTATION -> PS`, `XBOX -> XB`, and `PC -> PC`. Coin quantities are submitted in thousands (`250,000 -> 250`) and must use 1,000-coin increments. FUT monetary decimal values are converted to integer USD cents at the boundary.

For public purchasing, the adapter selects the lowest-price public supplier with sufficient stock and snapshots its supplier ID, capacity, quote, and expiry. For owned senders, it verifies `maxOrderConsole`/`maxOrderPC`; internal sender cost is configured in USD cents per 100K with `FUT_OWNED_COST_PER_100K_MINOR`.

## Duplicate and timeout safety

- The application order UUID is sent as FUT `externalOrderID` and is the durable idempotency/recovery key.
- Submission endpoints are called exactly once and are never automatically retried.
- A transport failure or timeout during submission produces durable `submissionState=UNKNOWN`.
- While UNKNOWN, confirmation is blocked and the dashboard displays **Recover FUT submission**.
- Recovery queries `/orderStatusAPI` with `externalID=1`. Only a confirmed lookup may move the order back into a submitted/processing state.
- HTTP 402 maps to insufficient balance, 406 to unavailable stock, 429 to rate limit, 401/403 to authentication failure. Read-only quote/status calls may use bounded exponential retry; mutations do not.

## Status mapping

Documented overall states:

- `ready`, `entered`, `waitingForAssignment` -> submitted to FUT.
- `partlyDelivered` -> processing.
- `finished` -> provider completion (application still requires proof and human completion).
- `interrupted` -> customer action required.

Documented account/economy action states such as wrong password, wrong backup code, CAPTCHA, console login, wrong persona/platform, full transfer list, insufficient customer coins, missing Transfer Market access, device ban, and below-minimum transfer map to explicit worker instructions. Unknown status codes never default to success or processing; they map to customer action/manual escalation and are recorded without secret response values.

## Controlled verification checklist

Do not run this checklist against live FUT without owner approval.

1. Configure approved low-risk FUT credentials in a non-production environment.
2. Verify balance and both capacity paths without submitting.
3. Submit one minimum-size approved test order with a unique external UUID.
4. Verify status lookup by provider ID and by external UUID.
5. Exercise one approved customer-action correction and resume.
6. Simulate/observe a timeout and prove the UI blocks a second submission.
7. Verify logs, FUT events, Telegram, exports, and errors contain no API/customer secrets.
8. Reconcile provider cost and proof, then delete the test customer's credentials under the retention policy.
