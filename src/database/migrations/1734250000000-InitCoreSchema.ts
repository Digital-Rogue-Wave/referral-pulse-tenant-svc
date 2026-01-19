import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitCoreSchema1734250000000 implements MigrationInterface {
    name = 'InitCoreSchema1734250000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

        await queryRunner.query(`
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_status_enum') THEN
        CREATE TYPE "tenant_status_enum" AS ENUM('active', 'suspended', 'locked', 'pending', 'deletion_scheduled');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenants_domain_verification_status_enum') THEN
        CREATE TYPE "tenants_domain_verification_status_enum" AS ENUM('unverified', 'pending', 'verified', 'failed');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_members_role_enum') THEN
        CREATE TYPE "team_members_role_enum" AS ENUM('OWNER', 'ADMIN', 'MEMBER');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_members_status_enum') THEN
        CREATE TYPE "team_members_status_enum" AS ENUM('active', 'suspended', 'invited');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitations_role_enum') THEN
        CREATE TYPE "invitations_role_enum" AS ENUM('OWNER', 'ADMIN', 'MEMBER');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitations_status_enum') THEN
        CREATE TYPE "invitations_status_enum" AS ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED', 'REJECTED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'api_keys_status_enum') THEN
        CREATE TYPE "api_keys_status_enum" AS ENUM('active', 'stopped');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_logs_action_enum') THEN
        CREATE TYPE "audit_logs_action_enum" AS ENUM(
            'tenant.created',
            'tenant.updated',
            'tenant.deleted',
            'tenant.deletion_scheduled',
            'tenant.deletion_cancelled',
            'tenant.suspended',
            'tenant.unsuspended',
            'member.invited',
            'member.joined',
            'member.role_updated',
            'member.removed',
            'settings.updated',
            'logo.uploaded',
            'domain.verified',
            'api_key.created',
            'api_key.updated',
            'api_key.stopped',
            'api_key.revoked',
            'api_key.deleted',
            'subscription.created',
            'subscription.updated',
            'subscription.cancelled',
            'subscription.downgrade_scheduled',
            'payment_method.updated',
            'ownership.transferred'
        );
    END IF;
END$$;
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "currencies" (
    "code" character varying(3) NOT NULL,
    "name" character varying NOT NULL,
    "symbol" character varying NOT NULL,
    "decimals" integer NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_currencies_code" PRIMARY KEY ("code")
)
        `);

        await queryRunner.query(`
INSERT INTO "currencies" ("code", "name", "symbol", "decimals")
VALUES ('USD', 'United States Dollar', '$', 2)
ON CONFLICT ("code") DO NOTHING
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "files" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "path" character varying NOT NULL,
    "mime_type" character varying NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_files_id" PRIMARY KEY ("id")
)
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "tenants" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "name" character varying NOT NULL,
    "slug" character varying NOT NULL,
    "image_id" uuid,
    "status" "tenant_status_enum" NOT NULL DEFAULT 'active',
    "deletion_scheduled_at" TIMESTAMP,
    "deletion_reason" text,
    "custom_domain" character varying,
    "domain_verification_status" "tenants_domain_verification_status_enum" NOT NULL DEFAULT 'unverified',
    "domain_verification_token" character varying,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_tenants_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_tenants_slug" UNIQUE ("slug"),
    CONSTRAINT "FK_tenants_image_id" FOREIGN KEY ("image_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION
)
        `);

        await queryRunner.query(`
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenants_custom_domain_unique" ON "tenants" ("custom_domain") WHERE "custom_domain" IS NOT NULL
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "tenant_settings" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "branding" jsonb NOT NULL,
    "notifications" jsonb NOT NULL,
    "general" jsonb NOT NULL,
    "currency_code" character varying(3) NOT NULL,
    "tenant_id" uuid NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_tenant_settings_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_tenant_settings_tenant_id" UNIQUE ("tenant_id"),
    CONSTRAINT "FK_tenant_settings_currency_code" FOREIGN KEY ("currency_code") REFERENCES "currencies"("code") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "FK_tenant_settings_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
)
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "reserved_subdomains" (
    "slug" character varying NOT NULL,
    "expires_at" TIMESTAMP NOT NULL,
    "original_tenant_id" character varying,
    CONSTRAINT "PK_reserved_subdomains_slug" PRIMARY KEY ("slug")
)
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "invitations" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" uuid NOT NULL,
    "email" character varying NOT NULL,
    "role" "invitations_role_enum" NOT NULL DEFAULT 'MEMBER',
    "status" "invitations_status_enum" NOT NULL DEFAULT 'PENDING',
    "token" character varying NOT NULL,
    "expires_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_invitations_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_invitations_token" UNIQUE ("token"),
    CONSTRAINT "FK_invitations_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
)
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "team_members" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" character varying NOT NULL,
    "tenant_id" uuid NOT NULL,
    "role" "team_members_role_enum" NOT NULL DEFAULT 'MEMBER',
    "status" "team_members_status_enum" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_team_members_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_team_members_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
)
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" uuid NOT NULL,
    "name" character varying NOT NULL,
    "key_hash" character varying NOT NULL,
    "key_prefix" character varying(20) NOT NULL,
    "status" "api_keys_status_enum" NOT NULL DEFAULT 'active',
    "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_by" character varying NOT NULL,
    "last_used_at" TIMESTAMP,
    "expires_at" TIMESTAMP NOT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_api_keys_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_api_keys_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
)
        `);

        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_api_keys_tenant_status" ON "api_keys" ("tenant_id", "status")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_api_keys_key_prefix" ON "api_keys" ("key_prefix")`);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "feature_flags" (
    "key" character varying NOT NULL,
    "description" character varying NOT NULL,
    "default_value" boolean NOT NULL DEFAULT false,
    "overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_feature_flags_key" PRIMARY KEY ("key")
)
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "user_notification_preferences" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" character varying NOT NULL,
    "tenant_id" uuid NOT NULL,
    "overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMP,
    CONSTRAINT "PK_user_notification_preferences_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_user_notification_preferences_user_tenant" UNIQUE ("user_id", "tenant_id"),
    CONSTRAINT "FK_user_notification_preferences_tenant_id" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
)
        `);

        await queryRunner.query(`
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" uuid NOT NULL,
    "user_id" uuid,
    "user_email" character varying,
    "action" "audit_logs_action_enum" NOT NULL,
    "description" text,
    "metadata" jsonb,
    "ip_address" character varying,
    "user_agent" character varying,
    "created_at" TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
)
        `);

        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_tenant_created_at" ON "audit_logs" ("tenant_id", "created_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_user_created_at" ON "audit_logs" ("user_id", "created_at")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action_created_at" ON "audit_logs" ("action", "created_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action_created_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_user_created_at"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_tenant_created_at"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);

        await queryRunner.query(`DROP TABLE IF EXISTS "user_notification_preferences"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "feature_flags"`);

        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_api_keys_key_prefix"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_api_keys_tenant_status"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "api_keys"`);

        await queryRunner.query(`DROP TABLE IF EXISTS "team_members"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "invitations"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "reserved_subdomains"`);

        await queryRunner.query(`DROP TABLE IF EXISTS "tenant_settings"`);

        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenants_custom_domain_unique"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "tenants"`);

        await queryRunner.query(`DROP TABLE IF EXISTS "files"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "currencies"`);

        await queryRunner.query(`DROP TYPE IF EXISTS "audit_logs_action_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "api_keys_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "invitations_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "invitations_role_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "team_members_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "team_members_role_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "tenants_domain_verification_status_enum"`);
        await queryRunner.query(`DROP TYPE IF EXISTS "tenant_status_enum"`);
    }
}
