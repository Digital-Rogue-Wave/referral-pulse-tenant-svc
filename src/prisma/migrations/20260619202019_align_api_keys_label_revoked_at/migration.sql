/*
  Warnings:

  - You are about to drop the column `name` on the `api_keys` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `api_keys` table. All the data in the column will be lost.
  - Added the required column `label` to the `api_keys` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "api_keys_tenant_id_status_idx";

-- AlterTable
ALTER TABLE "api_keys" DROP COLUMN "name",
DROP COLUMN "status",
ADD COLUMN     "label" VARCHAR(255) NOT NULL,
ADD COLUMN     "revoked_at" TIMESTAMPTZ;

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_revoked_at_idx" ON "api_keys"("tenant_id", "revoked_at");
