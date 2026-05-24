-- DropForeignKey
ALTER TABLE "selection_stage_results" DROP CONSTRAINT "selection_stage_results_session_id_fkey";

-- DropForeignKey
ALTER TABLE "selection_verdicts" DROP CONSTRAINT "selection_verdicts_session_id_fkey";

-- AlterTable
ALTER TABLE "interviews" ALTER COLUMN "scheduled_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "selection_sessions" ALTER COLUMN "token" SET DEFAULT uuidv7();

-- AddForeignKey
ALTER TABLE "selection_stage_results" ADD CONSTRAINT "selection_stage_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "selection_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selection_verdicts" ADD CONSTRAINT "selection_verdicts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "selection_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
