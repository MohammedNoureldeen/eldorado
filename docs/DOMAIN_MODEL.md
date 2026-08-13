# MVP v2 domain model

This document defines the units and invariants shared by the UI, API, jobs, reports, and FUT integration.

## Orders

- `orderReference` is an immutable organization-scoped sequence formatted `ELD-YYYY-NNNNNN` and allocated transactionally in UTC year order.
- `marketplaceReference` is optional, normalized to uppercase/condensed whitespace, and unique within an organization when present. `eldoradoOrderId` remains only as a nullable compatibility column during migration.
- `customerName` is operational data. `customerFingerprint` is a one-way SHA-256 hash scoped by organization and normalized customer name; it supports a 30-minute duplicate warning and never includes passwords or backup codes.
- `coinQuantity` is a whole number of FC coins, not thousands of coins. New orders require at least `200000`.
- `grossSaleMinor`, marketplace fee, FUT costs, refunds, and order profit are integer US cents. New orders always use `saleCurrency = USD`.
- The selected `MarketplaceFeePolicy` is snapshotted onto each order as `marketplaceFeeRateBps` and `marketplaceFeeMinor`; the launch fallback is 500 basis points (5%).
- `fulfillmentSource` is either `PUBLIC_SUPPLIER` or `OWNED_SENDERS`.

## FUT operations

- The internal order UUID is the durable `externalOrderId` and idempotency identity.
- `providerOrderId` and `motherOrderId` are separate fields.
- `submissionState` tracks safety state independently of mapped fulfillment status: `PREPARED`, `CONFIRMING`, `SUBMITTED`, `UNKNOWN`, `FAILED`, `COMPLETED`, or `CANCELLED`.
- Supplier, sender group, transfer method, risk, quote freshness, submission time, and last synchronization have dedicated fields.
- Request snapshots and API events may contain operational metadata only. Credentials, backup codes, `apiUser`, and `apiKey` are prohibited.

## Defaults and visibility

- Seeded settings use manual automation mode with the kill switch engaged, public supplier as the default source, and per-order quote visibility enabled.
- Payroll remains EGP and independent from USD order accounting.
