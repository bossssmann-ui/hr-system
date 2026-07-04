-- Add tenant-configurable auto-pipeline thresholds (Phase 7 NoCode config)
ALTER TABLE "tenant_settings"
ADD COLUMN "pipeline_thresholds" JSONB;
