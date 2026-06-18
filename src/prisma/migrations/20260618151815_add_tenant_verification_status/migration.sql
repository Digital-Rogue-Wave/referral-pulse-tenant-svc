-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "verification_status" VARCHAR(50) NOT NULL DEFAULT 'unverified';
