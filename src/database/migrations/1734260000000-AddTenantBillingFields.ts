import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantBillingFields1734260000000 implements MigrationInterface {
    name = 'AddTenantBillingFields1734260000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "billing_plan_enum" AS ENUM('Free', 'Starter', 'Growth', 'Enterprise')`);
        await queryRunner.query(`CREATE TYPE "subscription_status_enum" AS ENUM('none', 'active', 'canceled')`);

        await queryRunner.query(
            `ALTER TABLE "tenants" ADD "billing_plan" "billing_plan_enum" NOT NULL DEFAULT 'Free'`
        );
        await queryRunner.query(
            `ALTER TABLE "tenants" ADD "subscription_status" "subscription_status_enum" NOT NULL DEFAULT 'none'`
        );
        await queryRunner.query(`ALTER TABLE "tenants" ADD "stripe_customer_id" character varying`);
        await queryRunner.query(`ALTER TABLE "tenants" ADD "stripe_subscription_id" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "stripe_subscription_id"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "stripe_customer_id"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "subscription_status"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "billing_plan"`);
        await queryRunner.query(`DROP TYPE "subscription_status_enum"`);
        await queryRunner.query(`DROP TYPE "billing_plan_enum"`);
    }
}
