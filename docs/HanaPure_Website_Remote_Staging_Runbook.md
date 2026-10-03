# HanaPure Website — future remote staging runbook

Gate B2 provides local code and verification support. No remote environment has been created or verified. Provider signup, payment/plan changes, resources, secrets, migrations and grants require separate approval. This runbook is not authorization to perform them.

## Future sequence after approval

1. Approve the Vercel staging environment and plan, then create it with Node 24. Use a dedicated staging target; never assign staging secrets to production or unrelated previews.
2. Approve and create a separate Supabase staging project. Record only non-secret operational references outside this repository as appropriate.
3. Obtain its transaction-mode pooler host/port. Confirm TLS certificate verification works with the Node trust store. Gate B1 requires `rejectUnauthorized: true`; do not disable it or substitute a direct/session connection silently.
4. With separately approved migration-owner access, create a dedicated restricted runtime login. Assign only the existing `hanapure_override_runtime` capability, with no owner/superuser/role-creation/schema-creation authority or memberships that permit switching to a privileged role. The Website must use this login, never the owner or a Supabase service key.
5. Apply the exact reviewed migrations in order using approved owner tooling: `supabase/migrations/20260930120000_emergency_override_persistence.sql`, then `supabase/migrations/20261001120000_admin_authorization_foundation.sql`. Gate B2 tooling does not apply or repair migrations/grants.
6. Supply the restricted login to the read-only verifier (`createDatabaseReadinessProbe`) and verify the expected objects/effective grants. A failed result requires operator review, not automatic repair. This structural check does not attest every CHECK expression, migration source digest, external function privilege, provider API schema exposure, or all deployment security configuration; review these separately against the exact migrations.
7. Configure the server-only variables below for the staging target through approved secret management. Do not paste passwords, tokens or secrets into docs, source, shell arguments, reports, or Git. Avoid `NEXT_PUBLIC_` for this configuration. Do not create a credential file as part of this local milestone.
8. Deploy the staging target. Existing server code may call `getStagingRuntimeDependencies()` only from a Node server boundary. A future route that imports it must use `export const runtime = 'nodejs'` and receive separate exposure/authentication review. Gate B2 adds no HTTP route, UI or Server Action.
9. From an approved private operator context with the same staging config, run `npm run smoke:staging` once. It performs one bounded catalog SELECT through the existing B1 pool; it does not read business rows or mutate data. Exit 0 means configuration accepted and DB structural readiness passed. Auth `configured_not_verified` means construction only, not connectivity/session validation. A local operator process does not prove deployed Vercel lifecycle; measure that later through approved private deployment tooling.
10. Create Auth users, enroll TOTP and bootstrap Website admin authority only under separate approval. Do not use normal Website runtime to self-grant.
11. Separately measure real session revocation and MFA factor removal/stale AAL2 behavior. Existing local fixtures do not prove remote revocation behavior.
12. Review staging evidence with Command Center/HQ. Production creation/promotion is never automatic. Cloudflare/ERP wiring remains a separate HOLD.

## Server configuration contract

| Variable | Future value |
| --- | --- |
| `HANAPURE_STAGING_ENABLED` | Literal `true`, only after approval |
| `HANAPURE_ENVIRONMENT` | Literal `staging` |
| `HANAPURE_STAGING_DB_HOST` | Approved transaction-mode pooler host |
| `HANAPURE_STAGING_DB_PORT` | Approved numeric port |
| `HANAPURE_STAGING_DB_NAME` | Approved staging database |
| `HANAPURE_STAGING_DB_USER` | Dedicated restricted runtime login |
| `HANAPURE_STAGING_DB_PASSWORD` | Supplied by approved secret management |
| `HANAPURE_STAGING_AUTH_URL` | HTTPS Auth project origin |
| `HANAPURE_STAGING_AUTH_PUBLISHABLE_KEY` | Public `sb_publishable_` key; no secret/service key |

When Vercel markers are present, only `VERCEL_ENV=preview` and `VERCEL_TARGET_ENV=staging` are accepted. Verify the actual provider variable contract before enabling the seam. `production` is rejected. In a private local Node harness those Vercel markers can be absent. `NEXT_RUNTIME`, when present, must be `nodejs`. Node 24 is always required. `NODE_ENV` is not used as a staging marker.

## Status and bounds

Configuration: `disabled`, `invalid`, `ready`. Database: `not_checked`, `database_unavailable`, `schema_mismatch`, `permissions_mismatch`, `ready`. Auth: `not_checked`, `configured_not_verified`.

The output includes no credentials, SQL, stack, provider error body, user identifier or filesystem path. No product stock/readiness or checkout permission is derived from it. The diagnostic function exposes no mutation/token input.

B1 pool is reused (`max:1`, verified TLS). Connection/checkout 5 seconds; each query/read 20 seconds; idle 10 seconds; shutdown 5 seconds. One smoke uses one SELECT and zero retries. Shutdown closes the operator process's scope; a Next warm instance must not close its shared scope after each request. Config rotation requires a warm-instance restart.

The verifier checks four private tables, columns/types/nullability, identity collation, primary/unique keys, validated constraint counts, exact deferred FK definitions, enabled immutable-history triggers/function, effective table/column privileges, grant options, PUBLIC access, ownership and dangerous role membership. It fails closed on unexpected shape. It is verification support, not a full database security audit or a production enablement flag.
