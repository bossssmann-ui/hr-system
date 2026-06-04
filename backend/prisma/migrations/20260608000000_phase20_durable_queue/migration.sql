CREATE TABLE IF NOT EXISTS "queue_jobs" (
  "id" UUID PRIMARY KEY,
  "queue_name" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_retries" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "queue_jobs_status_check" CHECK ("status" IN ('pending', 'processing', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS "queue_jobs_pending_available_idx"
  ON "queue_jobs"("status", "available_at", "created_at");

CREATE INDEX IF NOT EXISTS "queue_jobs_queue_status_idx"
  ON "queue_jobs"("queue_name", "status", "available_at");
