CREATE TABLE IF NOT EXISTS "cron_job_runs" (
  "id" UUID PRIMARY KEY,
  "job_name" TEXT NOT NULL,
  "tenant_id" UUID,
  "scheduled_window" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "cron_job_runs_status_check" CHECK ("status" IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS "cron_job_runs_job_window_idx"
  ON "cron_job_runs"("job_name", "scheduled_window", "attempt");

CREATE INDEX IF NOT EXISTS "cron_job_runs_tenant_idx"
  ON "cron_job_runs"("tenant_id", "job_name", "scheduled_window");
