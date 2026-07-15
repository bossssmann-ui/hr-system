-- Horizon 8 — eNPS / Engagement Surveys
-- Additive-only: two new tables + two new enum types.
-- No existing tables are modified.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "engagement_survey_kind"   AS ENUM ('enps', 'pulse');
CREATE TYPE "engagement_survey_status" AS ENUM ('draft', 'open', 'closed');

-- ─────────────────────────────────────────────────────────────────────────────
-- engagement_surveys
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "engagement_surveys" (
    "id"                  UUID                       NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID                       NOT NULL,
    "title"               TEXT                       NOT NULL,
    "kind"                "engagement_survey_kind"   NOT NULL,
    "status"              "engagement_survey_status" NOT NULL DEFAULT 'draft',
    "question"            TEXT                       NOT NULL,
    "opened_at"           TIMESTAMP(3),
    "closes_at"           TIMESTAMP(3),
    "closed_at"           TIMESTAMP(3),
    "created_by_user_id"  UUID                       NOT NULL,
    "created_at"          TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "engagement_surveys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "engagement_surveys_tenant_id_idx" ON "engagement_surveys" ("tenant_id");
CREATE INDEX "engagement_surveys_status_idx"    ON "engagement_surveys" ("status");

-- ─────────────────────────────────────────────────────────────────────────────
-- survey_responses
-- One row per (survey, employee). Score 0–10 (eNPS scale).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "survey_responses" (
    "id"                      UUID         NOT NULL DEFAULT uuidv7(),
    "tenant_id"               UUID         NOT NULL,
    "survey_id"               UUID         NOT NULL,
    "respondent_employee_id"  UUID         NOT NULL,
    "score"                   INTEGER      NOT NULL,
    "comment"                 TEXT,
    "submitted_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "survey_responses_pkey"        PRIMARY KEY ("id"),
    CONSTRAINT "survey_responses_score_range" CHECK ("score" BETWEEN 0 AND 10),
    CONSTRAINT "survey_responses_survey_id_fkey"
        FOREIGN KEY ("survey_id")
        REFERENCES "engagement_surveys" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "survey_responses_employee_id_fkey"
        FOREIGN KEY ("respondent_employee_id")
        REFERENCES "employees" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "survey_responses_survey_employee_uk"
    ON "survey_responses" ("survey_id", "respondent_employee_id");
CREATE INDEX "survey_responses_tenant_id_idx" ON "survey_responses" ("tenant_id");
CREATE INDEX "survey_responses_survey_id_idx" ON "survey_responses" ("survey_id");
