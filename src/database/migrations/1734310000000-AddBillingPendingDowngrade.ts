import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingPendingDowngrade1734310000000 implements MigrationInterface {
    name = 'AddBillingPendingDowngrade1734310000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billings" ADD "pending_downgrade_plan" "billing_plan_enum"`);
        await queryRunner.query(`ALTER TABLE "billings" ADD "downgrade_scheduled_at" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billings" DROP COLUMN "downgrade_scheduled_at"`);
        await queryRunner.query(`ALTER TABLE "billings" DROP COLUMN "pending_downgrade_plan"`);
    }
}
