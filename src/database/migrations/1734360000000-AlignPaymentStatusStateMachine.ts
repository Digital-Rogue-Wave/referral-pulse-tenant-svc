import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignPaymentStatusStateMachine1734360000000 implements MigrationInterface {
    name = 'AlignPaymentStatusStateMachine1734360000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "payment_status_changed_at" TIMESTAMP`
        );

        await queryRunner.query(
            `UPDATE "tenants" SET "payment_status_changed_at" = now() WHERE "payment_status_changed_at" IS NULL`
        );

        await queryRunner.query(`
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum_new') THEN
            CREATE TYPE "payment_status_enum_new" AS ENUM('active', 'past_due', 'restricted', 'locked');
        END IF;

        ALTER TABLE "tenants" ALTER COLUMN "payment_status" DROP DEFAULT;

        ALTER TABLE "tenants"
        ALTER COLUMN "payment_status" TYPE "payment_status_enum_new"
        USING (
            CASE "payment_status"::text
                WHEN 'completed' THEN 'active'
                WHEN 'pending' THEN 'past_due'
                WHEN 'failed' THEN 'locked'
                ELSE 'active'
            END
        )::"payment_status_enum_new";

        DROP TYPE "payment_status_enum";
        ALTER TYPE "payment_status_enum_new" RENAME TO "payment_status_enum";

        ALTER TABLE "tenants" ALTER COLUMN "payment_status" SET DEFAULT 'active';
    END IF;
END$$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_enum_old') THEN
            CREATE TYPE "payment_status_enum_old" AS ENUM('pending', 'completed', 'failed');
        END IF;

        ALTER TABLE "tenants" ALTER COLUMN "payment_status" DROP DEFAULT;

        ALTER TABLE "tenants"
        ALTER COLUMN "payment_status" TYPE "payment_status_enum_old"
        USING (
            CASE "payment_status"::text
                WHEN 'active' THEN 'completed'
                WHEN 'past_due' THEN 'pending'
                WHEN 'restricted' THEN 'failed'
                WHEN 'locked' THEN 'failed'
                ELSE 'pending'
            END
        )::"payment_status_enum_old";

        DROP TYPE "payment_status_enum";
        ALTER TYPE "payment_status_enum_old" RENAME TO "payment_status_enum";

        ALTER TABLE "tenants" ALTER COLUMN "payment_status" SET DEFAULT 'pending';
    END IF;
END$$;
        `);

        await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "payment_status_changed_at"`);
    }
}
