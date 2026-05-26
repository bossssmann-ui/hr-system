-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "employee_status" ADD VALUE 'onboarding';
ALTER TYPE "employee_status" ADD VALUE 'notice';

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employment_documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "onboarding_checklists" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "onboarding_tasks" ALTER COLUMN "updated_at" DROP DEFAULT;
