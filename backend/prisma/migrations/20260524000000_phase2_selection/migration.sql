-- Phase 2 — Automated Selection System (Onboardix 4-stage screening).
-- Creates selection_templates, selection_sessions, selection_stage_results,
-- selection_verdicts with RLS policies.

-- ─────────────────────────────────────────────────────────────────────────────
-- SelectionTemplate
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "selection_templates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "stages" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selection_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "selection_templates_tenant_id_idx" ON "selection_templates"("tenant_id");
CREATE INDEX "selection_templates_vacancy_id_idx" ON "selection_templates"("vacancy_id");

ALTER TABLE "selection_templates" ADD CONSTRAINT "selection_templates_vacancy_id_fkey"
    FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- SelectionSession
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "selection_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "application_id" UUID,
    "template_id" UUID NOT NULL,
    "token" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selection_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "selection_sessions_token_key" ON "selection_sessions"("token");
CREATE INDEX "selection_sessions_tenant_id_idx" ON "selection_sessions"("tenant_id");
CREATE INDEX "selection_sessions_application_id_idx" ON "selection_sessions"("application_id");

ALTER TABLE "selection_sessions" ADD CONSTRAINT "selection_sessions_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "selection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- SelectionStageResult
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "selection_stage_results" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID NOT NULL,
    "stage_number" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "scores" JSONB,
    "flags" JSONB,
    "ai_evaluation" JSONB,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selection_stage_results_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "selection_stage_results_session_id_idx" ON "selection_stage_results"("session_id");

ALTER TABLE "selection_stage_results" ADD CONSTRAINT "selection_stage_results_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "selection_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- SelectionVerdict
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "selection_verdicts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID NOT NULL,
    "verdict" TEXT NOT NULL,
    "total_weighted_score" DECIMAL(65,30),
    "stage_scores" JSONB,
    "cross_check_flags" JSONB,
    "lie_scale_result" JSONB,
    "verdict_reason" TEXT,
    "hr_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "selection_verdicts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "selection_verdicts_session_id_key" ON "selection_verdicts"("session_id");

ALTER TABLE "selection_verdicts" ADD CONSTRAINT "selection_verdicts_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "selection_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — HR can manage, public routes use service role bypass
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "selection_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "selection_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "selection_templates_select" ON "selection_templates" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "selection_templates_write" ON "selection_templates" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

ALTER TABLE "selection_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "selection_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "selection_sessions_select" ON "selection_sessions" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "selection_sessions_write" ON "selection_sessions" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

ALTER TABLE "selection_stage_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "selection_stage_results" FORCE ROW LEVEL SECURITY;
CREATE POLICY "selection_stage_results_select" ON "selection_stage_results" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM selection_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
        )
    );
CREATE POLICY "selection_stage_results_write" ON "selection_stage_results" FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM selection_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM selection_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    );

ALTER TABLE "selection_verdicts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "selection_verdicts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "selection_verdicts_select" ON "selection_verdicts" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM selection_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
        )
    );
CREATE POLICY "selection_verdicts_write" ON "selection_verdicts" FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM selection_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM selection_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON
    "selection_templates",
    "selection_sessions",
    "selection_stage_results",
    "selection_verdicts"
TO app_user;
