import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantCustomDomainFields1734340000000 implements MigrationInterface {
    name = 'AddTenantCustomDomainFields1734340000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenants_domain_verification_status_enum') THEN
        CREATE TYPE "tenants_domain_verification_status_enum" AS ENUM('unverified', 'pending', 'verified', 'failed');
    END IF;
END$$;
        `);

        await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "custom_domain" character varying`);
        await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "domain_verification_status" "tenants_domain_verification_status_enum" NOT NULL DEFAULT 'unverified'`);
        await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "domain_verification_token" character varying`);

        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenants_custom_domain_unique" ON "tenants" ("custom_domain") WHERE "custom_domain" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_custom_domain_unique"`);

        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "domain_verification_token"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "domain_verification_status"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "custom_domain"`);

        await queryRunner.query(`DROP TYPE IF EXISTS "tenants_domain_verification_status_enum"`);
    }
}
