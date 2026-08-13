-- Phase 1 is additive: preserve legacy order data while introducing the MVP v2 domain.
CREATE TYPE "FulfillmentSource" AS ENUM ('PUBLIC_SUPPLIER', 'OWNED_SENDERS');
CREATE TYPE "FutSubmissionState" AS ENUM ('PREPARED', 'CONFIRMING', 'SUBMITTED', 'UNKNOWN', 'FAILED', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Order"
  ALTER COLUMN "eldoradoOrderId" DROP NOT NULL,
  ADD COLUMN "orderReference" TEXT,
  ADD COLUMN "marketplaceReference" TEXT,
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "customerFingerprint" TEXT,
  ADD COLUMN "fulfillmentSource" "FulfillmentSource" NOT NULL DEFAULT 'PUBLIC_SUPPLIER',
  ADD COLUMN "marketplaceFeeRateBps" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "marketplaceFeePolicyId" UUID;

WITH ranked AS (
  SELECT "id", EXTRACT(YEAR FROM "createdAt")::INTEGER AS year,
         ROW_NUMBER() OVER (PARTITION BY "organizationId", EXTRACT(YEAR FROM "createdAt") ORDER BY "createdAt", "id") AS sequence
  FROM "Order"
)
UPDATE "Order" AS target
SET "orderReference" = 'ELD-' || ranked.year::TEXT || '-' || LPAD(ranked.sequence::TEXT, 6, '0'),
    "marketplaceReference" = target."eldoradoOrderId",
    "customerName" = 'Legacy customer ' || COALESCE(target."eldoradoOrderId", LEFT(target."id"::TEXT, 8)),
    "customerFingerprint" = MD5(target."organizationId"::TEXT || ':' || COALESCE(target."eldoradoOrderId", target."id"::TEXT)),
    "marketplaceFeeRateBps" = CASE
      WHEN target."grossSaleMinor" > 0 THEN LEAST(10000, GREATEST(0, ROUND(target."marketplaceFeeMinor"::NUMERIC * 10000 / target."grossSaleMinor")::INTEGER))
      ELSE 500
    END
FROM ranked
WHERE target."id" = ranked."id";

ALTER TABLE "Order"
  ALTER COLUMN "orderReference" SET NOT NULL,
  ALTER COLUMN "customerName" SET NOT NULL,
  ALTER COLUMN "customerFingerprint" SET NOT NULL;

CREATE TABLE "OrderReferenceCounter" (
  "organizationId" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "OrderReferenceCounter_pkey" PRIMARY KEY ("organizationId", "year")
);

INSERT INTO "OrderReferenceCounter" ("organizationId", "year", "nextValue")
SELECT "organizationId", EXTRACT(YEAR FROM "createdAt")::INTEGER, COUNT(*)::INTEGER + 1
FROM "Order"
GROUP BY "organizationId", EXTRACT(YEAR FROM "createdAt");

CREATE TABLE "MarketplaceFeePolicy" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "feeBps" INTEGER NOT NULL DEFAULT 500,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceFeePolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketplaceFeePolicy_feeBps_check" CHECK ("feeBps" BETWEEN 0 AND 10000)
);

INSERT INTO "MarketplaceFeePolicy" ("id", "organizationId", "feeBps", "effectiveFrom", "updatedAt")
SELECT MD5("id"::TEXT || ':marketplace-fee-v1')::UUID, "id", 500, TIMESTAMP '2026-08-13 00:00:00', CURRENT_TIMESTAMP
FROM "Organization";

UPDATE "Order"
SET "marketplaceFeePolicyId" = MD5("organizationId"::TEXT || ':marketplace-fee-v1')::UUID
WHERE "marketplaceFeeRateBps" = 500;

ALTER TABLE "FutOrder"
  ADD COLUMN "motherOrderId" TEXT,
  ADD COLUMN "externalOrderId" TEXT,
  ADD COLUMN "submissionState" "FutSubmissionState" NOT NULL DEFAULT 'PREPARED',
  ADD COLUMN "fulfillmentSource" "FulfillmentSource",
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "supplierHash" TEXT,
  ADD COLUMN "isPublicSupplier" BOOLEAN,
  ADD COLUMN "senderGroup" TEXT,
  ADD COLUMN "transferMethod" TEXT,
  ADD COLUMN "riskLevel" TEXT,
  ADD COLUMN "quoteFetchedAt" TIMESTAMP(3),
  ADD COLUMN "quoteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

UPDATE "FutOrder" AS fut
SET "externalOrderId" = fut."orderId"::TEXT,
    "fulfillmentSource" = orders."fulfillmentSource",
    "submissionState" = CASE fut."status"
      WHEN 'PREPARED' THEN 'PREPARED'::"FutSubmissionState"
      WHEN 'FAILED' THEN 'FAILED'::"FutSubmissionState"
      WHEN 'COMPLETED' THEN 'COMPLETED'::"FutSubmissionState"
      WHEN 'CANCELLED' THEN 'CANCELLED'::"FutSubmissionState"
      ELSE 'SUBMITTED'::"FutSubmissionState"
    END,
    "quoteFetchedAt" = fut."createdAt",
    "lastSyncedAt" = COALESCE(fut."completedAt", fut."submittedAt")
FROM "Order" AS orders
WHERE orders."id" = fut."orderId";

ALTER TABLE "FutOrder"
  ALTER COLUMN "externalOrderId" SET NOT NULL,
  ALTER COLUMN "fulfillmentSource" SET NOT NULL;

DROP INDEX "Order_organizationId_eldoradoOrderId_key";
CREATE UNIQUE INDEX "Order_organizationId_orderReference_key" ON "Order"("organizationId", "orderReference");
CREATE UNIQUE INDEX "Order_organizationId_marketplaceReference_key" ON "Order"("organizationId", "marketplaceReference");
CREATE INDEX "Order_duplicate_warning_idx" ON "Order"("organizationId", "customerFingerprint", "platform", "coinQuantity", "grossSaleMinor", "createdAt");
CREATE UNIQUE INDEX "FutOrder_externalOrderId_key" ON "FutOrder"("externalOrderId");
CREATE INDEX "MarketplaceFeePolicy_organizationId_active_effectiveFrom_idx" ON "MarketplaceFeePolicy"("organizationId", "active", "effectiveFrom");

ALTER TABLE "OrderReferenceCounter" ADD CONSTRAINT "OrderReferenceCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceFeePolicy" ADD CONSTRAINT "MarketplaceFeePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_marketplaceFeePolicyId_fkey" FOREIGN KEY ("marketplaceFeePolicyId") REFERENCES "MarketplaceFeePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
