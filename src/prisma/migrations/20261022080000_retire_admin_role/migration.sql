-- R-ACT-01: "There are exactly five internal roles ... No other role exists; 'Program Admin',
-- 'Account Owner', 'Marketer/Operator' and 'Viewer' are retired names for the same four tenant
-- roles." `ADMIN` was the retired Program Admin, carried as a custom role under decision T-1 because
-- ownership transfer demoted the outgoing Owner to it. That path now demotes to `OPERATOR`, so the
-- role has no remaining purpose and the enum no longer contains it.
--
-- Existing holders are remapped **down**, to `OPERATOR` (Campaign Manager), never up. ADMIN granted
-- every namespace except billing, with tenant deletion reserved to the Owner; OPERATOR is the
-- highest standard role below Owner. Mapping to Owner instead would hand a former admin billing and
-- tenant deletion — a privilege escalation performed by a migration, which is the one thing a
-- migration must never do. Anyone who should hold more can be promoted deliberately afterwards.
--
-- Forward-only. There is no down migration: re-creating the role would not restore which members
-- held it.

-- 1. The denormalized role on the membership row, and any invitation still offering the role.
UPDATE "users" SET "role" = 'OPERATOR', "updated_at" = now() WHERE "role" = 'ADMIN';
UPDATE "invitations" SET "role" = 'OPERATOR', "updated_at" = now() WHERE "role" = 'ADMIN';

-- 2. The `user_roles` display projection. A member already holding OPERATOR would collide on the
--    composite primary key (user_id, role_id), so those rows are dropped rather than repointed.
DELETE FROM "user_roles" ur
USING "roles" a, "roles" o
WHERE a."name" = 'ADMIN'
  AND o."name" = 'OPERATOR'
  AND ur."role_id" = a."id"
  AND EXISTS (SELECT 1 FROM "user_roles" held WHERE held."user_id" = ur."user_id" AND held."role_id" = o."id");

UPDATE "user_roles" ur SET "role_id" = o."id"
FROM "roles" a, "roles" o
WHERE a."name" = 'ADMIN' AND o."name" = 'OPERATOR' AND ur."role_id" = a."id";

-- 3. Refuse to continue if anything still points at the role. `user_roles.role_id` cascades on
--    delete, so a missing OPERATOR catalog row would otherwise make step 4 silently delete live
--    assignments instead of moving them.
DO $$
DECLARE orphaned bigint;
BEGIN
    SELECT count(*) INTO orphaned
    FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
    WHERE r."name" = 'ADMIN';

    IF orphaned > 0 THEN
        RAISE EXCEPTION 'retire_admin_role: % user_roles rows still reference ADMIN — is the OPERATOR catalog row missing? Run the seed first.', orphaned;
    END IF;
END $$;

-- 4. The catalog row itself. `roles` is a projection for dashboard display, re-derived from
--    ROLE_GRANTS by the seed, so removing the row is the whole of it.
DELETE FROM "roles" WHERE "name" = 'ADMIN';
