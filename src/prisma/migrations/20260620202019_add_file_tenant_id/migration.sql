-- AlterTable
ALTER TABLE "files" ADD COLUMN     "tenant_id" VARCHAR(26);

-- CreateIndex
CREATE INDEX "files_tenant_id_idx" ON "files"("tenant_id");
