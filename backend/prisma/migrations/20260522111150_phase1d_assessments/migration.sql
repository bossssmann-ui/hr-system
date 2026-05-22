-- CreateEnum
CREATE TYPE "AssessmentQuestionType" AS ENUM ('open', 'single_choice', 'multi_choice');

-- CreateEnum
CREATE TYPE "AssessmentSessionStatus" AS ENUM ('invited', 'consented', 'in_progress', 'submitted', 'graded', 'expired');

-- DropForeignKey
ALTER TABLE "interviews" DROP CONSTRAINT "interviews_application_id_fkey";

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "ai_interview_questions" JSONB,
ADD COLUMN     "trust_flagged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "interviews" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "assessment_templates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "vacancy_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "time_limit_min" INTEGER,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "template_id" UUID NOT NULL,
    "question_order" INTEGER NOT NULL,
    "type" "AssessmentQuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "rubric" TEXT,
    "competency" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "invite_token" TEXT NOT NULL,
    "status" "AssessmentSessionStatus" NOT NULL DEFAULT 'invited',
    "consent_recorded" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "trust_score" INTEGER,
    "trust_signals" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_answers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "session_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer" JSONB NOT NULL,
    "ai_grade" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessment_templates_tenant_id_idx" ON "assessment_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "assessment_templates_vacancy_id_idx" ON "assessment_templates"("vacancy_id");

-- CreateIndex
CREATE INDEX "assessment_questions_template_id_idx" ON "assessment_questions"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_questions_template_order_key" ON "assessment_questions"("template_id", "question_order");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_sessions_invite_token_key" ON "assessment_sessions"("invite_token");

-- CreateIndex
CREATE INDEX "assessment_sessions_tenant_id_idx" ON "assessment_sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "assessment_sessions_application_id_idx" ON "assessment_sessions"("application_id");

-- CreateIndex
CREATE INDEX "assessment_answers_session_id_idx" ON "assessment_answers"("session_id");

-- CreateIndex
CREATE INDEX "assessment_answers_question_id_idx" ON "assessment_answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_answers_session_question_key" ON "assessment_answers"("session_id", "question_id");

-- AddForeignKey
ALTER TABLE "assessment_templates" ADD CONSTRAINT "assessment_templates_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "assessment_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_sessions" ADD CONSTRAINT "assessment_sessions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "assessment_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "assessment_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (tenant scope)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "assessment_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "assessment_templates_select" ON "assessment_templates" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "assessment_templates_write" ON "assessment_templates" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

ALTER TABLE "assessment_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_questions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "assessment_questions_select" ON "assessment_questions" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM assessment_templates t
            WHERE t.id = template_id
              AND t.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
        )
    );
CREATE POLICY "assessment_questions_write" ON "assessment_questions" FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM assessment_templates t
            WHERE t.id = template_id
              AND t.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM assessment_templates t
            WHERE t.id = template_id
              AND t.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    );

ALTER TABLE "assessment_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "assessment_sessions_select" ON "assessment_sessions" FOR SELECT
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
    );
CREATE POLICY "assessment_sessions_write" ON "assessment_sessions" FOR ALL
    USING (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    )
    WITH CHECK (
        tenant_id = app.current_tenant_id()
        AND (app.is_admin() OR app.has_role('recruiter'))
    );

ALTER TABLE "assessment_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_answers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "assessment_answers_select" ON "assessment_answers" FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM assessment_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter') OR app.has_role('hiring_manager'))
        )
    );
CREATE POLICY "assessment_answers_write" ON "assessment_answers" FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM assessment_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM assessment_sessions s
            WHERE s.id = session_id
              AND s.tenant_id = app.current_tenant_id()
              AND (app.is_admin() OR app.has_role('recruiter'))
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON
    "assessment_templates",
    "assessment_questions",
    "assessment_sessions",
    "assessment_answers"
TO app_user;
