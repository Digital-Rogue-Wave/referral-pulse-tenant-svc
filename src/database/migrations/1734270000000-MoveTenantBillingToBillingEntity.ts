import { MigrationInterface, QueryRunner } from 'typeorm';

export class MoveTenantBillingToBillingEntity1734270000000 implements MigrationInterface {
    name = 'MoveTenantBillingToBillingEntity1734270000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "billings" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "tenant_id" uuid NOT NULL,
                "plan" "billing_plan_enum" NOT NULL DEFAULT 'Free',
                "status" "subscription_status_enum" NOT NULL DEFAULT 'none',
                "stripe_customer_id" character varying,
                "stripe_subscription_id" character varying,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_billings_id" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_billings_tenant_id" ON "billings" ("tenant_id")`);
        await queryRunner.query(`
            ALTER TABLE "billings"
            ADD CONSTRAINT "FK_billings_tenant_id" FOREIGN KEY ("tenant_id")
            REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            INSERT INTO "billings" ("tenant_id", "plan", "status", "stripe_customer_id", "stripe_subscription_id", "created_at", "updated_at")
            SELECT "id", "billing_plan", "subscription_status", "stripe_customer_id", "stripe_subscription_id", now(), now()
            FROM "tenants"
        `);

        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "stripe_subscription_id"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "stripe_customer_id"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "subscription_status"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "billing_plan"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "billing_plan" "billing_plan_enum" NOT NULL DEFAULT 'Free'
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "subscription_status" "subscription_status_enum" NOT NULL DEFAULT 'none'
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "stripe_customer_id" character varying
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "stripe_subscription_id" character varying
        `);

        await queryRunner.query(`
            UPDATE "tenants" t
            SET
                "billing_plan" = b."plan",
                "subscription_status" = b."status",
                "stripe_customer_id" = b."stripe_customer_id",
                "stripe_subscription_id" = b."stripe_subscription_id"
            FROM "billings" b
            WHERE b."tenant_id" = t."id"
        `);

        await queryRunner.query(`ALTER TABLE "billings" DROP CONSTRAINT "FK_billings_tenant_id"`);
        await queryRunner.query(`DROP INDEX "IDX_billings_tenant_id"`);
        await queryRunner.query(`DROP TABLE "billings"`);
    }
}
