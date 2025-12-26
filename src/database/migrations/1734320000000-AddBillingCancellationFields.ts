import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingCancellationFields1734320000000 implements MigrationInterface {
    name = 'AddBillingCancellationFields1734320000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billings" ADD "cancellation_reason" text`);
        await queryRunner.query(`ALTER TABLE "billings" ADD "cancellation_requested_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "billings" ADD "cancellation_effective_at" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billings" DROP COLUMN "cancellation_effective_at"`);
        await queryRunner.query(`ALTER TABLE "billings" DROP COLUMN "cancellation_requested_at"`);
        await queryRunner.query(`ALTER TABLE "billings" DROP COLUMN "cancellation_reason"`);
    }
}
