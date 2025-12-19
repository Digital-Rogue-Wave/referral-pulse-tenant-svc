import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingTransactionId1734280000000 implements MigrationInterface {
    name = 'AddBillingTransactionId1734280000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billings" ADD "stripe_transaction_id" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "billings" DROP COLUMN "stripe_transaction_id"`);
    }
}
