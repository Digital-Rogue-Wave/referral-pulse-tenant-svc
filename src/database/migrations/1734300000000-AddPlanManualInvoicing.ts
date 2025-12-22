import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanManualInvoicing1734300000000 implements MigrationInterface {
    name = 'AddPlanManualInvoicing1734300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "plans" ADD "manual_invoicing" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "plans" DROP COLUMN "manual_invoicing"
        `);
    }
}
