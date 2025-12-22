import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillingPhaseOneEntities1734290000000 implements MigrationInterface {
    name = 'AddBillingPhaseOneEntities1734290000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "plans" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "stripe_price_id" character varying,
                "stripe_product_id" character varying,
                "interval" character varying,
                "limits" jsonb,
                "tenant_id" uuid,
                "is_active" boolean NOT NULL DEFAULT true,
                "metadata" jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_plans_id" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            ALTER TABLE "plans"
            ADD CONSTRAINT "FK_plans_tenant_id" FOREIGN KEY ("tenant_id")
            REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE TABLE "tenant_usages" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "tenant_id" uuid NOT NULL,
                "metric_name" character varying NOT NULL,
                "period_date" date NOT NULL,
                "current_usage" integer NOT NULL DEFAULT 0,
                "limit_value" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_tenant_usages_id" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_tenant_usages_tenant_metric_period"
            ON "tenant_usages" ("tenant_id", "metric_name", "period_date")
        `);

        await queryRunner.query(`
            ALTER TABLE "tenant_usages"
            ADD CONSTRAINT "FK_tenant_usages_tenant_id" FOREIGN KEY ("tenant_id")
            REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            CREATE TABLE "billing_events" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "tenant_id" uuid NOT NULL,
                "event_type" character varying NOT NULL,
                "metric_name" character varying,
                "increment" integer,
                "timestamp" TIMESTAMP NOT NULL,
                "metadata" jsonb,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP,
                CONSTRAINT "PK_billing_events_id" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_billing_events_tenant_timestamp"
            ON "billing_events" ("tenant_id", "timestamp")
        `);

        await queryRunner.query(`
            ALTER TABLE "billing_events"
            ADD CONSTRAINT "FK_billing_events_tenant_id" FOREIGN KEY ("tenant_id")
            REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);

        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "trial_started_at" TIMESTAMP
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "trial_ends_at" TIMESTAMP
        `);

        await queryRunner.query(`
            CREATE TYPE "payment_status_enum" AS ENUM('pending', 'completed', 'failed')
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "payment_status" "payment_status_enum" NOT NULL DEFAULT 'pending'
        `);

        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "suspended_at" TIMESTAMP
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" ADD "locked_at" TIMESTAMP
        `);

        await queryRunner.query(`
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_status_enum') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumlabel = 'locked'
              AND enumtypid = 'tenant_status_enum'::regtype
        ) THEN
            ALTER TYPE "tenant_status_enum" ADD VALUE 'locked';
        END IF;
    END IF;
END$$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "locked_at"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "suspended_at"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "payment_status"`);
        await queryRunner.query(`DROP TYPE "payment_status_enum"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "trial_ends_at"`);
        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "trial_started_at"`);

        await queryRunner.query(`ALTER TABLE "billing_events" DROP CONSTRAINT "FK_billing_events_tenant_id"`);
        await queryRunner.query(`DROP INDEX "IDX_billing_events_tenant_timestamp"`);
        await queryRunner.query(`DROP TABLE "billing_events"`);

        await queryRunner.query(`ALTER TABLE "tenant_usages" DROP CONSTRAINT "FK_tenant_usages_tenant_id"`);
        await queryRunner.query(`DROP INDEX "IDX_tenant_usages_tenant_metric_period"`);
        await queryRunner.query(`DROP TABLE "tenant_usages"`);

        await queryRunner.query(`ALTER TABLE "plans" DROP CONSTRAINT "FK_plans_tenant_id"`);
        await queryRunner.query(`DROP TABLE "plans"`);
    }
}
