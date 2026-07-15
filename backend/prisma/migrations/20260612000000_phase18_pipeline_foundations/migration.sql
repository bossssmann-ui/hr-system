-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "scoring_weights" JSONB;

-- AlterTable
ALTER TABLE "vacancies" ADD COLUMN     "required_assessment_template_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "composite_score" JSONB;

