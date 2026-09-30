-- Unit 2E: apply with a migration owner, never the Website runtime credential.
-- No credentials/login or Supabase resource is provisioned by this migration.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hanapure_override_runtime') THEN
    CREATE ROLE hanapure_override_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hanapure_override_runtime'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'pre-existing override runtime role has unsafe attributes';
  END IF;
END
$$;

CREATE SCHEMA hanapure_private;
REVOKE ALL ON SCHEMA hanapure_private FROM PUBLIC;
GRANT USAGE ON SCHEMA hanapure_private TO hanapure_override_runtime;

CREATE TABLE hanapure_private.override_current (
  public_id text COLLATE "C" PRIMARY KEY,
  revision numeric NOT NULL CHECK (revision = trunc(revision) AND revision BETWEEN 1 AND 9007199254740991),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  created_at timestamptz(3) NOT NULL,
  expires_at timestamptz(3),
  revoked_at timestamptz(3),
  CHECK (record ? 'publicId' AND record->>'publicId' = public_id),
  CHECK (record ? 'createdAt' AND (record->>'createdAt')::timestamptz = created_at),
  CHECK ((record->>'expiresAt')::timestamptz IS NOT DISTINCT FROM expires_at),
  CHECK ((record->'revocation'->>'at')::timestamptz IS NOT DISTINCT FROM revoked_at)
);

CREATE TABLE hanapure_private.override_audit (
  public_id text COLLATE "C" NOT NULL,
  revision numeric NOT NULL CHECK (revision = trunc(revision) AND revision BETWEEN 1 AND 9007199254740991),
  operation_id text COLLATE "C" NOT NULL UNIQUE,
  previous_revision numeric CHECK (previous_revision = trunc(previous_revision) AND previous_revision BETWEEN 1 AND 9007199254740991),
  occurred_at timestamptz(3) NOT NULL,
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  PRIMARY KEY (public_id, revision),
  UNIQUE (operation_id, public_id, revision),
  CHECK (event ?& ARRAY['publicId', 'operationId', 'revision', 'at', 'before', 'after', 'actorId', 'reason', 'action']),
  CHECK (event->>'publicId' = public_id AND event->>'operationId' = operation_id),
  CHECK (jsonb_typeof(event->'revision') = 'string' AND event->>'revision' = revision::text),
  CHECK ((event->>'at')::timestamptz = occurred_at)
);

CREATE TABLE hanapure_private.override_receipts (
  operation_id text COLLATE "C" PRIMARY KEY,
  public_id text COLLATE "C" NOT NULL,
  revision numeric NOT NULL CHECK (revision = trunc(revision) AND revision BETWEEN 1 AND 9007199254740991),
  semantic_payload jsonb NOT NULL CHECK (jsonb_typeof(semantic_payload) = 'array' AND jsonb_array_length(semantic_payload) = 8),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  CHECK (semantic_payload->>0 = public_id AND semantic_payload->>1 = operation_id),
  CHECK (result ?& ARRAY['ok', 'revision', 'event'] AND result->'ok' = 'true'::jsonb),
  CHECK (jsonb_typeof(result->'revision') = 'string' AND result->>'revision' = revision::text),
  CHECK (result->'event'->>'operationId' = operation_id AND result->'event'->>'publicId' = public_id)
);

-- Deferred persistence-integrity links prevent a state/event without its audit/
-- receipt at COMMIT, while permitting the adapter's three ordered writes.
ALTER TABLE hanapure_private.override_current ADD CONSTRAINT current_has_audit
  FOREIGN KEY (public_id, revision) REFERENCES hanapure_private.override_audit (public_id, revision)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hanapure_private.override_audit ADD CONSTRAINT audit_has_receipt
  FOREIGN KEY (operation_id) REFERENCES hanapure_private.override_receipts (operation_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hanapure_private.override_receipts ADD CONSTRAINT receipt_has_audit
  FOREIGN KEY (operation_id, public_id, revision)
  REFERENCES hanapure_private.override_audit (operation_id, public_id, revision)
  DEFERRABLE INITIALLY DEFERRED;

-- Integrity enforcement only: all business transitions stay in Unit 2D TS.
CREATE FUNCTION hanapure_private.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'override history is append-only' USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION hanapure_private.reject_history_mutation() FROM PUBLIC;
CREATE TRIGGER immutable_override_audit BEFORE UPDATE OR DELETE OR TRUNCATE
  ON hanapure_private.override_audit FOR EACH STATEMENT
  EXECUTE FUNCTION hanapure_private.reject_history_mutation();
CREATE TRIGGER immutable_override_receipts BEFORE UPDATE OR DELETE OR TRUNCATE
  ON hanapure_private.override_receipts FOR EACH STATEMENT
  EXECUTE FUNCTION hanapure_private.reject_history_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA hanapure_private FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON hanapure_private.override_current TO hanapure_override_runtime;
GRANT SELECT, INSERT ON hanapure_private.override_audit, hanapure_private.override_receipts TO hanapure_override_runtime;
-- Prevent accidental public grants on subsequent owner-created schema objects.
ALTER DEFAULT PRIVILEGES IN SCHEMA hanapure_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA hanapure_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
