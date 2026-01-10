import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixAuditLogsTimestamps1734350000000 implements MigrationInterface {
    name = 'FixAuditLogsTimestamps1734350000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "deleted_at"`);
        await queryRunner.query(`ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "updated_at"`);
    }
}
