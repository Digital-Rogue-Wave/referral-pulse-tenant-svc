-- DB Model v5 §3: `roles.scopes` → `roles.keto_relations`.
--
-- Not only a rename. §3 defines the column as "the relation set this role grants, e.g.
-- ["campaigns:write","rewards:approve"]", and it also states that `roles`/`user_roles` are "a
-- projection for dashboard display and bulk assignment, not the authoritative permission store" —
-- Ory Keto is.
--
-- The column held wildcards from an older vocabulary ('tenant:*', 'users:*', 'api_keys:*') that are
-- not Keto relations and did not match ROLE_GRANTS in permission-catalog.ts, which is what the
-- guards actually enforce. So anything rendering a role's permissions from this table showed
-- permissions that are not granted, and omitted ones that are.
--
-- Existing values are cleared rather than translated: there is no faithful mapping from a wildcard
-- to a relation set, and the seed now writes the real set derived from ROLE_GRANTS, so a stale
-- value must not survive the rename and masquerade as current.
ALTER TABLE "roles" RENAME COLUMN "scopes" TO "keto_relations";
UPDATE "roles" SET "keto_relations" = '[]'::jsonb;
