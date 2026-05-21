-- Phase 1A HH negotiations sync schema.

ALTER TABLE "vacancies"
    ADD COLUMN "hh_vacancy_id" TEXT;

ALTER TABLE "candidates"
    ADD COLUMN "consent_context" JSONB;

ALTER TABLE "applications"
    ADD COLUMN "external_ids" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "hh_connections" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "connected_employer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hh_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hh_sync_cursors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "last_negotiation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hh_sync_cursors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vacancies_hh_vacancy_id_key" ON "vacancies"("hh_vacancy_id");
CREATE UNIQUE INDEX "hh_connections_tenant_id_key" ON "hh_connections"("tenant_id");
CREATE INDEX "hh_connections_tenant_id_idx" ON "hh_connections"("tenant_id");
CREATE UNIQUE INDEX "hh_sync_cursors_vacancy_id_key" ON "hh_sync_cursors"("vacancy_id");
CREATE INDEX "hh_sync_cursors_tenant_id_idx" ON "hh_sync_cursors"("tenant_id");
CREATE INDEX "hh_sync_cursors_vacancy_id_idx" ON "hh_sync_cursors"("vacancy_id");

ALTER TABLE "hh_sync_cursors"
    ADD CONSTRAINT "hh_sync_cursors_vacancy_id_fkey"
    FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
