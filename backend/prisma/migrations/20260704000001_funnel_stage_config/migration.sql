-- Add tenant-configurable funnel stage display config (Horizon 7 · PR 3)
ALTER TABLE "tenant_settings"
ADD COLUMN "funnel_stage_config" JSONB;
