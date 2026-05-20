-- Phase 0 recruiting baseline.
--
-- Hand-written migration that materialises the schema declared in
-- `backend/prisma/schema.prisma` for Phase 0. The matching `prisma migrate
-- diff` output is checked in here so local/dev/CI databases stay in sync with
-- the Prisma client without requiring a live PostgreSQL during PR review. The
-- companion migration `20260520000001_phase0_rls` enables Row-Level Security
-- and policies on top of these tables.
--
-- Conventions:
--   * `tenant_id UUID NOT NULL` on every business table (see
--     `docs/contracts/10-data-model.md`). No DEFAULT; the value is set from
--     the authenticated session (RLS session variable `app.tenant_id`) and
--     never from user input.
--   * Primary keys default to `uuidv7()` (PostgreSQL 18 native).
--   * Snake-case table/column names matching the Prisma `@@map` / `@map`.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "RoleName" AS ENUM ('owner', 'hr_admin', 'recruiter', 'hiring_manager', 'employee', 'candidate');
CREATE TYPE "Currency" AS ENUM ('RUB', 'USD', 'THB', 'USDT');
CREATE TYPE "RequisitionStatus" AS ENUM ('draft', 'submitted', 'manager_approved', 'hr_approved', 'approved', 'in_recruitment', 'closed', 'rejected');
CREATE TYPE "CandidateSource" AS ENUM ('manual', 'hh_ru', 'sberpodbor', 'avito', 'rabota_ru', 'referral', 'careers_page');
CREATE TYPE "ApplicationStage" AS ENUM ('new', 'screen', 'tech', 'final', 'offer', 'hired', 'rejected');
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'telegram', 'in_app');

-- ─────────────────────────────────────────────────────────────────────────────
-- Tenant
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Identity
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role" "RoleName" NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role", "tenant_id")
);

CREATE INDEX "user_roles_tenant_id_idx" ON "user_roles"("tenant_id");

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Org structure
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "org_units" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "org_units_tenant_id_idx" ON "org_units"("tenant_id");
CREATE INDEX "org_units_parent_id_idx" ON "org_units"("parent_id");

ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recruiting
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "hiring_requisitions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "salary_min" INTEGER NOT NULL,
    "salary_max" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'draft',
    "deadline_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hiring_requisitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hiring_requisitions_salary_range_check" CHECK ("salary_min" <= "salary_max")
);

CREATE INDEX "hiring_requisitions_tenant_id_idx" ON "hiring_requisitions"("tenant_id");
CREATE INDEX "hiring_requisitions_org_unit_id_idx" ON "hiring_requisitions"("org_unit_id");
CREATE INDEX "hiring_requisitions_created_by_user_id_idx" ON "hiring_requisitions"("created_by_user_id");
CREATE INDEX "hiring_requisitions_status_idx" ON "hiring_requisitions"("status");

ALTER TABLE "hiring_requisitions" ADD CONSTRAINT "hiring_requisitions_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "vacancies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "requisition_id" UUID NOT NULL,
    "org_unit_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vacancies_requisition_id_key" ON "vacancies"("requisition_id");
CREATE INDEX "vacancies_tenant_id_idx" ON "vacancies"("tenant_id");
CREATE INDEX "vacancies_org_unit_id_idx" ON "vacancies"("org_unit_id");

ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_requisition_id_fkey"
    FOREIGN KEY ("requisition_id") REFERENCES "hiring_requisitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_org_unit_id_fkey"
    FOREIGN KEY ("org_unit_id") REFERENCES "org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "candidates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "source" "CandidateSource" NOT NULL DEFAULT 'manual',
    "external_ids" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "candidates_tenant_id_idx" ON "candidates"("tenant_id");

-- Partial unique indexes: email / phone are unique only when present, and
-- always scoped per tenant. Prisma cannot express partial indexes
-- declaratively, so they live in raw SQL here (see docs/contracts/10-data-model.md).
CREATE UNIQUE INDEX "candidates_tenant_email_unique" ON "candidates"("tenant_id", "email") WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "candidates_tenant_phone_unique" ON "candidates"("tenant_id", "phone") WHERE "phone" IS NOT NULL;

CREATE TABLE "resumes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "parsed_payload" JSONB,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resumes_tenant_id_idx" ON "resumes"("tenant_id");
CREATE INDEX "resumes_candidate_id_idx" ON "resumes"("candidate_id");

ALTER TABLE "resumes" ADD CONSTRAINT "resumes_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'new',
    "assigned_to_user_id" UUID,
    "notes" TEXT,
    "ai_scoring" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "applications_candidate_vacancy_unique" ON "applications"("candidate_id", "vacancy_id");
CREATE INDEX "applications_tenant_id_idx" ON "applications"("tenant_id");
CREATE INDEX "applications_vacancy_id_idx" ON "applications"("vacancy_id");
CREATE INDEX "applications_stage_idx" ON "applications"("stage");
CREATE INDEX "applications_assigned_to_user_id_idx" ON "applications"("assigned_to_user_id");

ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_vacancy_id_fkey"
    FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "application_stage_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_stage" "ApplicationStage" NOT NULL,
    "to_stage" "ApplicationStage" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_stage_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "application_stage_events_tenant_id_idx" ON "application_stage_events"("tenant_id");
CREATE INDEX "application_stage_events_application_id_idx" ON "application_stage_events"("application_id");
CREATE INDEX "application_stage_events_actor_user_id_idx" ON "application_stage_events"("actor_user_id");

ALTER TABLE "application_stage_events" ADD CONSTRAINT "application_stage_events_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cross-cutting
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "diff" JSONB NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_entity_idx" ON "audit_events"("entity_type", "entity_id");
CREATE INDEX "audit_events_actor_created_idx" ON "audit_events"("actor_user_id", "created_at");
CREATE INDEX "audit_events_tenant_id_idx" ON "audit_events"("tenant_id");

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_tenant_id_idx" ON "notifications"("tenant_id");
CREATE INDEX "notifications_recipient_read_idx" ON "notifications"("recipient_user_id", "read_at");
