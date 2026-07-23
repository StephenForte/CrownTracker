# PRD: Remote MCP OAuth Hardening and Coverage

## Introduction/Overview

The remote CrownTracker MCP connector exposes a single read-only metrics tool through OAuth. Its initial implementation has sound PKCE, opaque-token hashing, and transactional code/token rotation, but it also creates a public database-write surface, has no user-accessible revocation path, and gives insufficient context at authorization time.

This phase makes the connector safe to enable deliberately for the single owner. It adds a complete feature gate, bounded public registration and authorization behavior, transparent consent, durable revocation, retention, a least-privilege database path, and executable end-to-end coverage. The connector remains read-only and must never trigger research, provider calls, or collection mutations.

## Goals

- Make remote MCP opt-in and fully unavailable when disabled.
- Prevent public registration and password attempts from creating unbounded database or operational load.
- Let the owner see and revoke every external connector grant, including all grants at once.
- Make every consent decision identify the exact destination receiving access.
- Limit the MCP runtime to read-only market-metric data.
- Cover the OAuth lifecycle, failure cases, and migration with automated tests against disposable Postgres.

## Non-Goals

- Multi-user accounts, sharing, organizations, billing, or delegated collection access.
- Additional MCP tools, write operations, refreshes, or paid-provider calls.
- Credentialed scraping, browser automation, Redis, queues, or a new external service.
- Replacing the app's existing single-password login system in this phase.
- Supporting arbitrary production OAuth clients without deliberate registration controls.

## User Stories

### US-001: Explicitly enable or disable the remote connector

**Description:** As the owner, I want one deliberate setting that disables every remote MCP and OAuth endpoint until I choose to enable it.

**Acceptance Criteria:**

- [ ] Introduce `MCP_REMOTE_ENABLED`, disabled unless exactly `"true"`.
- [ ] When disabled, `/mcp`, both OAuth metadata routes, `/oauth/register`, `/oauth/authorize`, and `/oauth/token` return a uniform non-disclosing `404` or `503` response and perform no database reads or writes.
- [ ] `MCP_PUBLIC_BASE_URL` is required only when `MCP_REMOTE_ENABLED=true`, and must be canonical HTTPS in production.
- [ ] The flag and URL are documented in `.env.example`, `render.yaml`, and `README.md`.
- [ ] Existing local stdio MCP usage remains unaffected.

### US-002: Bound public client registration and authorization attempts

**Description:** As the owner, I want remote setup to work with a legitimate connector without allowing anonymous traffic to fill the database or repeatedly guess my password.

**Acceptance Criteria:**

- [ ] Dynamic registration validates a bounded JSON payload: 1–10 unique redirect URIs, a bounded client name, no fragments, and only HTTPS or loopback-local HTTP redirects.
- [ ] Registration is rate-limited and has a durable maximum number of active clients; rejected attempts do not insert client rows.
- [ ] Authorization failures are rate-limited with a bounded cooldown/backoff. Successful authorization clears the relevant failure state.
- [ ] Limits use the existing Postgres deployment or a small in-process helper only; do not add Redis or a new service.
- [ ] Responses are generic enough to avoid client/token enumeration, and logs never include passwords, authorization codes, access tokens, refresh tokens, or Authorization headers.
- [ ] The implementation uses a timing-safe password comparison where practical for the configured secret.

### US-003: Give informed, destination-specific consent

**Description:** As the owner, I want the approval page to clearly identify the connector and exact redirect destination before I enter the app password.

**Acceptance Criteria:**

- [ ] The authorization page displays the registered client name and the normalized redirect origin/host prominently.
- [ ] The page states that the grant is read-only, names the `crowntracker.read` scope, states the 30-day refresh-grant lifetime, and says how to revoke access.
- [ ] The user must explicitly confirm the displayed destination before the password submission can create a code.
- [ ] Client-controlled text is HTML-escaped; response headers include `Cache-Control: no-store`, clickjacking protection, a restrictive Content-Security-Policy, and a restrictive referrer policy.
- [ ] The redirect URI must still exactly match the registered URI at authorization-code exchange.

### US-004: Manage and revoke connected clients

**Description:** As the owner, I want to inspect and revoke external connector access without manually editing production tables.

**Acceptance Criteria:**

- [ ] Add an authenticated dashboard surface showing each active MCP client: display name, redirect origin, issued/last-used time, and current status.
- [ ] Provide per-client revoke and revoke-all controls, each with explicit confirmation.
- [ ] Revoking a client invalidates every access and refresh token for that client immediately; revoke-all invalidates all current grants.
- [ ] Changing `APP_PASSWORD` is documented as insufficient for token revocation; the UI is the supported revocation path.
- [ ] Ownership remains single-user and tokens/grants are not exposed in the UI or API.

### US-005: Retain only active OAuth state

**Description:** As the owner, I want expired and revoked OAuth records removed automatically so the connector does not accumulate historical secrets or bloat the database.

**Acceptance Criteria:**

- [ ] Add a bounded, idempotent cleanup routine for consumed/expired authorization codes, expired or revoked tokens, and clients with no active grants past a documented retention period.
- [ ] Run cleanup as part of an existing safe maintenance path or a small Render Cron Job; it must not call paid providers.
- [ ] Cleanup records only aggregate operational outcomes, never secrets.
- [ ] Migration indexes support active-token validation, client management, rate-limit lookup, and cleanup without table scans at expected scale.

### US-006: Enforce a read-only database path

**Description:** As the owner, I want an MCP code or SDK regression to be unable to modify collection or research data.

**Acceptance Criteria:**

- [ ] Configure a separate `MCP_DATABASE_URL` (or equivalent narrowly scoped connection) for the remote MCP server.
- [ ] The associated Postgres role can read only the fields/tables needed for active-watch metrics and OAuth validation, and cannot invoke research, modify collection data, or access unrelated raw listing/evidence content.
- [ ] If the read-only connection is missing when remote MCP is enabled, the MCP endpoint fails closed.
- [ ] Database provisioning and role grants are documented for Render; no manual production SQL is required beyond the versioned migration/setup procedure.

### US-007: Add executable OAuth and MCP coverage

**Description:** As the maintainer, I want automated evidence that the public authentication boundary works and fails safely.

**Acceptance Criteria:**

- [ ] Keep the existing unit tests and add route/helper tests for disabled mode, metadata discovery, invalid origins, missing/invalid bearer tokens, scope/resource enforcement, and the read-only tool contract.
- [ ] Add disposable-Postgres integration coverage for client registration, valid PKCE authorization-code exchange, code replay rejection, concurrent code exchange, refresh rotation/replay rejection, expiry, per-client revoke, revoke-all, and cleanup.
- [ ] Add tests proving rejected registration and failed authorization attempts do not create unbounded rows and that enabled/disabled transitions make no unintended writes.
- [ ] Add migration tests on a fresh schema and an already-migrated schema; rerunning the migration must succeed.
- [ ] Add an end-to-end route test that verifies no unauthenticated request can invoke an MCP tool and that the valid tool returns only active-watch metrics without starting a refresh or calling a paid provider.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` pass. The integration suite must be clearly separable from the default unit suite when it needs Postgres.

## Functional Requirements

- FR-1: Remote MCP availability is controlled by one explicit feature flag applied before every public MCP/OAuth route reaches database code.
- FR-2: OAuth supports only authorization-code plus S256 PKCE and the single `crowntracker.read` scope.
- FR-3: Registration, failed authorization, and client state are bounded by named configuration constants rather than magic numbers.
- FR-4: The approval screen tells the owner exactly which redirect origin will receive the authorization response.
- FR-5: An owner can revoke any client or all clients from the authenticated app, with immediate token invalidation.
- FR-6: Access and refresh tokens, codes, passwords, and Authorization headers are never persisted in plaintext or written to logs.
- FR-7: Expired and revoked OAuth state is removed on a defined schedule without removing market history.
- FR-8: The remote MCP process uses a database credential that cannot write CrownTracker business data.
- FR-9: The sole remote MCP tool remains `get_active_watch_metrics`; it returns active-watch derived metrics only and does not use Tavily, Anthropic, WatchBase, or pipeline execution.

## Technical Considerations

- Add new migrations rather than changing `009_mcp_oauth.sql`; they must be idempotent and compatible with the existing single-owner data.
- Keep OAuth secrets hashed with SHA-256 and preserve transactional `FOR UPDATE` handling for code consumption and refresh rotation.
- The app's normal database role may continue to administer OAuth client/revocation state through authenticated routes. The remote MCP handler itself must use the constrained connection.
- Prefer a small Postgres-backed rate-limit/client-state model over Redis or new infrastructure. Define explicit TTLs and cleanup indexes.
- Do not trust `Origin` as authentication. Bearer-token verification remains mandatory for every MCP transport request.
- Document exact Render environment variables, role setup, cleanup invocation, manual revocation procedure, and staging verification checklist.

## Release Plan

1. Implement and run all unit, integration, migration, typecheck, and production-build checks locally.
2. Deploy to a staging Render service with a staging database, distinct password, and `MCP_REMOTE_ENABLED=true`.
3. Run one real connector authorization flow against staging; verify registration, consent wording, tool output, revocation, token replay rejection, cleanup, and logs.
4. Deploy production with `MCP_REMOTE_ENABLED=false` first. Confirm all MCP/OAuth endpoints fail closed and no OAuth writes occur.
5. Enable the feature only after the owner confirms the canonical URL, read-only database role, rate limits, and revocation UI. Monitor registration rejects, failed authorizations, grants, revocations, and cleanup counts without logging secrets.

## Success Metrics

- Disabled remote routes perform zero OAuth-table writes under repeated requests.
- A valid connector completes the PKCE flow and reads metrics without spending research credits.
- A revoked token and its refresh token are rejected immediately.
- Expired OAuth records remain bounded by the retention policy.
- Automated tests exercise every OAuth grant transition and key public-route rejection path.

## Open Questions

- What active-client cap and rate-limit windows fit the expected Claude/Cowork setup behavior while maintaining a conservative public-write budget?
- Should the maintenance cleanup be a dedicated no-provider Render Cron Job or piggyback on a low-frequency existing job?
- Confirm whether Render deployment supports provisioning the separate read-only database role through the repository migration flow, or whether a documented one-time owner setup is necessary.
