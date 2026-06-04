ALTER TABLE "applications"
  ADD COLUMN "ai_score" DECIMAL(10,4),
  ADD COLUMN "ai_verdict" TEXT,
  ADD COLUMN "ai_assessed_at" TIMESTAMP(3),
  ADD COLUMN "ai_flags" JSONB;

CREATE UNIQUE INDEX "selection_sessions_application_id_active_key"
  ON "selection_sessions"("application_id")
  WHERE "application_id" IS NOT NULL
    AND "status" NOT IN ('completed', 'rejected', 'expired');
