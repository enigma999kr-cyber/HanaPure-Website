-- Apply with the migration owner, never the Website runtime credential.
-- No provisioning: grants/revokes/bootstrap require a separately approved operator.
BEGIN;
CREATE TABLE hanapure_private.admin_principals (
  auth_user_id uuid PRIMARY KEY,
  permission text NOT NULL CHECK (permission = 'emergency_override:mutate'),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED', 'DISABLED')),
  granted_at timestamptz(3) NOT NULL,
  granted_by text NOT NULL CHECK (length(btrim(granted_by)) > 0),
  revoked_at timestamptz(3),
  revoked_by text,
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL AND revoked_by IS NULL) OR
    (status IN ('REVOKED', 'DISABLED') AND revoked_at IS NOT NULL AND revoked_at >= granted_at
      AND revoked_by IS NOT NULL AND length(btrim(revoked_by)) > 0))
);
REVOKE ALL ON hanapure_private.admin_principals FROM PUBLIC, hanapure_override_runtime;
GRANT SELECT ON hanapure_private.admin_principals TO hanapure_override_runtime;
-- No management role/method, SECURITY DEFINER function or Auth signup trigger.
-- Supabase API schema exposure and deployment login memberships need staging review.
COMMIT;
