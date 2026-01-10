import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantLockFields1734330000000 implements MigrationInterface {
    name = 'AddTenantLockFields1734330000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lock_until" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "lock_reason" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "lock_reason"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "lock_until"`);
    }
}
