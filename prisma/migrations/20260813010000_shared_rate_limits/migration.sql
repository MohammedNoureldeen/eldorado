CREATE TABLE "RateLimitBucket" (
    "keyHash" VARCHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
