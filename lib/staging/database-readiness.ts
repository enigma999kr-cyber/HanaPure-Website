import "server-only";

import type { Pool, PoolClient } from "pg";

export type DatabaseReadiness = "ready" | "schema_mismatch" | "permissions_mismatch" | "database_unavailable";
const columns: Record<string, string[]> = {
  override_current: ["public_id:text:true", "revision:numeric:true", "record:jsonb:true", "created_at:timestamp(3) with time zone:true",
    "expires_at:timestamp(3) with time zone:false", "revoked_at:timestamp(3) with time zone:false"],
  override_audit: ["public_id:text:true", "revision:numeric:true", "operation_id:text:true", "previous_revision:numeric:false",
    "occurred_at:timestamp(3) with time zone:true", "event:jsonb:true"],
  override_receipts: ["operation_id:text:true", "public_id:text:true", "revision:numeric:true", "semantic_payload:jsonb:true", "result:jsonb:true"],
  admin_principals: ["auth_user_id:uuid:true", "permission:text:true", "status:text:true", "granted_at:timestamp(3) with time zone:true",
    "granted_by:text:true", "revoked_at:timestamp(3) with time zone:false", "revoked_by:text:false"],
};
const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const allowed: Record<string, string[]> = { override_current: ["SELECT", "INSERT", "UPDATE"],
  override_audit: ["SELECT", "INSERT"], override_receipts: ["SELECT", "INSERT"], admin_principals: ["SELECT"] };
const keys: Record<string, string[]> = { override_current: ["PRIMARY KEY (public_id)"],
  override_audit: ["PRIMARY KEY (public_id, revision)", "UNIQUE (operation_id)", "UNIQUE (operation_id, public_id, revision)"],
  override_receipts: ["PRIMARY KEY (operation_id)"], admin_principals: ["PRIMARY KEY (auth_user_id)"] };
const checkCounts: Record<string, number> = { override_current: 6, override_audit: 7, override_receipts: 7, admin_principals: 4 };
const foreignKeys: Record<string, string> = {
  current_has_audit: "FOREIGN KEY (public_id, revision) REFERENCES hanapure_private.override_audit(public_id, revision) DEFERRABLE INITIALLY DEFERRED",
  audit_has_receipt: "FOREIGN KEY (operation_id) REFERENCES hanapure_private.override_receipts(operation_id) DEFERRABLE INITIALLY DEFERRED",
  receipt_has_audit: "FOREIGN KEY (operation_id, public_id, revision) REFERENCES hanapure_private.override_audit(operation_id, public_id, revision) DEFERRABLE INITIALLY DEFERRED",
};
const sorted = (values: string[]) => [...values].sort().join("|");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Structural readiness, not a substitute for applying/reviewing the exact approved migrations. */
export function classifyDatabaseSnapshot(value: unknown): DatabaseReadiness {
  if (!object(value) || !object(value.schema) || !Array.isArray(value.tables) || !Array.isArray(value.functions)) return "schema_mismatch";
  const schema = value.schema;
  if (schema.exists !== true || value.tables.length !== 4 || value.functions.length !== 1) return "schema_mismatch";
  const seen = new Set<string>();
  for (const table of value.tables) {
    if (!object(table) || typeof table.name !== "string" || !Object.hasOwn(columns, table.name) || seen.has(table.name)) return "schema_mismatch";
    seen.add(table.name);
    if (table.kind !== "r" || table.rls !== false || table.plainColumns !== true || table.identityCollation !== true || !Array.isArray(table.columns) ||
      table.columns.some((col: unknown) => typeof col !== "string") || sorted(table.columns) !== sorted(columns[table.name]) ||
      !Array.isArray(table.constraints) || !Array.isArray(table.triggers)) return "schema_mismatch";
    const constraints = table.constraints;
    if (constraints.some((c: unknown) => !object(c) || c.valid !== true || typeof c.definition !== "string")) return "schema_mismatch";
    if (constraints.filter((c) => c.type === "c").length !== checkCounts[table.name]) return "schema_mismatch";
    const actualKeys = constraints.filter((c) => c.type === "p" || c.type === "u").map((c) => c.definition);
    if (actualKeys.some((s) => typeof s !== "string") || sorted(actualKeys) !== sorted(keys[table.name])) return "schema_mismatch";
    const expectedFK = table.name === "override_current" ? "current_has_audit" : table.name === "override_audit" ? "audit_has_receipt" :
      table.name === "override_receipts" ? "receipt_has_audit" : null;
    const fks = constraints.filter((c) => c.type === "f");
    if (fks.length !== (expectedFK ? 1 : 0) || expectedFK &&
      (fks[0].name !== expectedFK || fks[0].definition !== foreignKeys[expectedFK])) return "schema_mismatch";
    if (constraints.some((c) => !["c", "p", "u", "f"].includes(c.type))) return "schema_mismatch";
    const expectedTrigger = ["override_audit", "override_receipts"].includes(table.name) ? `immutable_${table.name}` : null;
    if (table.triggers.length !== (expectedTrigger ? 1 : 0)) return "schema_mismatch";
    if (expectedTrigger) {
      const trigger = table.triggers[0];
      // BEFORE statement UPDATE/DELETE/TRUNCATE, enabled for ordinary origin sessions.
      if (!object(trigger) || trigger.name !== expectedTrigger || trigger.enabled !== "O" || trigger.type !== 58 ||
        trigger.function !== "reject_history_mutation") return "schema_mismatch";
    }
    if (!object(table.privileges) || !object(table.columnPrivileges) || table.owner !== false || table.publicAccess !== false ||
      table.grantOption !== false) return "permissions_mismatch";
    for (const privilege of privileges) {
      if (table.privileges[privilege] !== allowed[table.name].includes(privilege)) return "permissions_mismatch";
    }
    for (const privilege of ["INSERT", "UPDATE", "SELECT", "REFERENCES"]) {
      if (table.columnPrivileges[privilege] !== allowed[table.name].includes(privilege)) return "permissions_mismatch";
    }
  }
  const fn = value.functions[0];
  if (!object(fn) || fn.name !== "reject_history_mutation" || fn.args !== 0 || fn.result !== "trigger" || fn.language !== "plpgsql" ||
    fn.securityDefiner !== false || !Array.isArray(fn.config) || sorted(fn.config) !== "search_path=pg_catalog" ||
    typeof fn.body !== "string" || fn.body.replace(/\s+/g, " ").trim() !==
      "BEGIN RAISE EXCEPTION 'override history is append-only' USING ERRCODE = '55000'; END") return "schema_mismatch";
  if (fn.executable !== false || fn.publicAccess !== false || fn.owner !== false || schema.usage !== true || schema.create !== false ||
    schema.owner !== false || schema.publicAccess !== false || value.roleSafe !== true) return "permissions_mismatch";
  return "ready";
}

/** A single unnamed SELECT over catalogs. No business rows, DDL, grants or repair. */
export const READINESS_SQL = `WITH ns AS (
  SELECT oid, nspowner, nspacl FROM pg_catalog.pg_namespace WHERE nspname = $1
), relations AS (
  SELECT c.* FROM pg_catalog.pg_class c JOIN ns ON c.relnamespace = ns.oid WHERE c.relkind IN ('r','p','v','m','f')
), functions AS (
  SELECT p.*, l.lanname FROM pg_catalog.pg_proc p JOIN ns ON p.pronamespace = ns.oid JOIN pg_catalog.pg_language l ON l.oid = p.prolang
)
SELECT pg_catalog.jsonb_build_object(
 'schema', pg_catalog.jsonb_build_object('exists', EXISTS(SELECT 1 FROM ns),
   'usage', (SELECT pg_catalog.has_schema_privilege(oid,'USAGE') FROM ns), 'create', (SELECT pg_catalog.has_schema_privilege(oid,'CREATE') FROM ns),
   'owner', (SELECT pg_catalog.pg_has_role(nspowner,'MEMBER') FROM ns),
   'publicAccess', (SELECT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(nspacl,pg_catalog.acldefault('n',nspowner))) WHERE grantee=0) FROM ns)),
 'roleSafe', EXISTS(SELECT 1 FROM pg_catalog.pg_roles me WHERE me.rolname=current_user AND me.rolcanlogin AND NOT EXISTS(
   SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(r.oid,'MEMBER') AND
     (r.rolname NOT IN (current_user,'hanapure_override_runtime') OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR
      EXISTS(SELECT 1 FROM ns WHERE ns.nspowner=r.oid OR pg_catalog.has_schema_privilege(r.oid,ns.oid,'CREATE')) OR
      EXISTS(SELECT 1 FROM relations WHERE relowner=r.oid) OR
      EXISTS(SELECT 1 FROM relations WHERE relname='admin_principals' AND
        (pg_catalog.has_table_privilege(r.oid,oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
         pg_catalog.has_any_column_privilege(r.oid,oid,'INSERT,UPDATE,REFERENCES')))))),
 'tables', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',r.relname,'kind',r.relkind,'rls',r.relrowsecurity,
   'owner',pg_catalog.pg_has_role(r.relowner,'MEMBER'),
   'publicAccess', EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(r.relacl,pg_catalog.acldefault('r',r.relowner))) WHERE grantee=0) OR
     EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) acl WHERE a.attrelid=r.oid AND acl.grantee=0),
   'grantOption', (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(r.oid,p || ' WITH GRANT OPTION')) FROM pg_catalog.unnest($2::text[]) p) OR
     (SELECT pg_catalog.bool_or(pg_catalog.has_any_column_privilege(r.oid,p || ' WITH GRANT OPTION')) FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p),
   'privileges', (SELECT pg_catalog.jsonb_object_agg(p,pg_catalog.has_table_privilege(r.oid,p)) FROM pg_catalog.unnest($2::text[]) p),
   'columnPrivileges', (SELECT pg_catalog.jsonb_object_agg(p,pg_catalog.has_any_column_privilege(r.oid,p)) FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p),
   'plainColumns', NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
     AND (a.atthasdef OR a.attgenerated<>'' OR a.attidentity<>'')),
   'identityCollation', NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation
     WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN ('public_id','operation_id') AND co.collname IS DISTINCT FROM 'C'),
   'columns', (SELECT pg_catalog.jsonb_agg(a.attname || ':' || pg_catalog.format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text ORDER BY a.attnum)
     FROM pg_catalog.pg_attribute a WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
   'constraints', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',co.conname,'type',co.contype,'valid',co.convalidated,
     'definition',pg_catalog.pg_get_constraintdef(co.oid))) FROM pg_catalog.pg_constraint co WHERE co.conrelid=r.oid AND co.contype<>'n'),'[]'::jsonb),
   'triggers', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'type',t.tgtype,
     'function',p.proname)) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
     WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),'[]'::jsonb))) FROM relations r),'[]'::jsonb),
 'functions', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',f.proname,'args',f.pronargs,'result',pg_catalog.format_type(f.prorettype,NULL),
   'language',f.lanname,'securityDefiner',f.prosecdef,'config',f.proconfig,'body',f.prosrc,
   'executable',pg_catalog.has_function_privilege(f.oid,'EXECUTE'),'owner',pg_catalog.pg_has_role(f.proowner,'MEMBER'),
   'publicAccess',EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) WHERE grantee=0))) FROM functions f),'[]'::jsonb)
) AS snapshot`;

/** Supply only the SAME trusted bounded runtime pool used by Unit 2E/2F. */
export function createDatabaseReadinessProbe(pool: Pick<Pool, "connect">) {
  return async (): Promise<DatabaseReadiness> => {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      const result = await client.query(READINESS_SQL, ["hanapure_private", privileges]);
      return classifyDatabaseSnapshot(result.rows[0]?.snapshot);
    } catch { return "database_unavailable"; }
    finally { client?.release(); }
  };
}
