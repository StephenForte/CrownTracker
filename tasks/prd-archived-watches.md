# PRD: Archived Watches List & Restore

## Introduction/Overview

Crown Tracker already supports archiving a watch (`watches.status = 'archived'`), which removes it from the main dashboard and stops research refreshes while preserving history. Restore already works on the watch detail page via `WatchStatusButton`, but there is no way to discover archived watches once they leave the dashboard.

This feature adds a dedicated archived watches page, navigation to find it, one-click restore from that list, and small detail-page polish so archived watches no longer show a Refresh action.

## Goals

- Let the user find every archived watch without needing a bookmarked URL
- Let the user open an archived watch’s existing detail page
- Let the user restore (un-archive) a watch so it reappears on the main dashboard
- Keep the main dashboard active-only (no archived clutter)
- Hide Refresh on archived detail pages (API already rejects it)

## User Stories

### US-001: Add Archived link to app navigation
**Description:** As a user, I want a clear nav link to archived watches so I can find them without memorizing a URL.

**Acceptance Criteria:**
- [ ] `AppShell` nav includes a link labeled “Archived” pointing to `/watches/archived`
- [ ] Link sits with existing nav actions (near “Add watch”) and uses the existing secondary button/link styling
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Create archived watches list page
**Description:** As a user, I want a simple list of archived watches so I can browse what I have set aside.

**Acceptance Criteria:**
- [ ] New server page at `app/watches/archived/page.tsx` (auth-gated like the dashboard)
- [ ] Loads watches with `getWatches("archived")` only
- [ ] Each row shows nickname, reference number, and model name
- [ ] Each row links to the existing detail page `/watches/[id]`
- [ ] Empty state when there are no archived watches (clear copy + link back to dashboard or “Add watch”)
- [ ] Page uses `AppShell` and existing layout/CSS patterns (no new design system)
- [ ] Does **not** show full market metric cards (simpler list than the dashboard)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Restore a watch from the archived list
**Description:** As a user, I want to un-archive a watch from the archived list in one click so I don’t have to open the detail page first.

**Acceptance Criteria:**
- [ ] Each archived list row includes a Restore control
- [ ] Restore calls existing `PATCH /api/watches/[id]` with `{ status: "active" }`
- [ ] On success, user is redirected to the main dashboard (`/`) and the watch appears there again
- [ ] Control shows a busy/disabled state while the request is in flight
- [ ] Reuse or lightly extend `WatchStatusButton` (or a small shared client helper) rather than duplicating PATCH logic
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Hide Refresh on archived detail pages
**Description:** As a user viewing an archived watch, I should not see a Refresh action that cannot succeed.

**Acceptance Criteria:**
- [ ] On `app/watches/[id]/page.tsx`, `RefreshButton` is not rendered when `watch.status === "archived"`
- [ ] Archive/Restore button remains available on the detail page
- [ ] Restoring from detail still redirects to `/` (existing behavior)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Verify end-to-end archive → find → restore flow
**Description:** As a user, I want the full loop to work so archived research stays recoverable.

**Acceptance Criteria:**
- [ ] Archive from detail → watch disappears from dashboard
- [ ] Watch appears on `/watches/archived`
- [ ] Opening detail from archived list works and shows archived status (no Refresh)
- [ ] Restore from list or detail → watch returns to dashboard and leaves the archived list
- [ ] `npm run typecheck` and `npm run build` pass
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: Add a dedicated page at `/watches/archived` that lists only watches with `status = 'archived'` for the signed-in owner.
- FR-2: Add an “Archived” navigation link in `AppShell` to `/watches/archived`.
- FR-3: Archived list rows must show nickname, reference number, and model name, and link to `/watches/[id]`.
- FR-4: Archived list rows must offer a Restore action that sets `status` to `active` via the existing PATCH API.
- FR-5: After a successful restore (from list or detail), redirect to the main dashboard `/`.
- FR-6: Main dashboard continues to load only `getWatches("active")`.
- FR-7: When viewing an archived watch detail page, do not render the Refresh button.
- FR-8: Show an empty state on `/watches/archived` when no archived watches exist.
- FR-9: Do not delete listings, metrics, runs, or other history when archiving or restoring; only flip `status`.

## Non-Goals

- No soft-delete / hard-delete of watches
- No dashboard status filter or `?status=archived` on `/`
- No full market metric cards on the archived list
- No new API endpoint for un-archive (reuse PATCH)
- No bulk restore / bulk archive
- No search/filter/sort on the archived list in this pass
- No changes to cron/pipeline active-only behavior
- No multi-user archive visibility rules (single-user app)

## Design Considerations

- Match existing `AppShell`, `.empty`, `.card` / list, and button classes in `app/globals.css`.
- Archived list should feel lighter than the dashboard: identity fields + restore, not metric-heavy market cards.
- Restore uses existing secondary styling; Archive on detail remains danger styling.
- Prefer extending `WatchStatusButton` with an optional redirect/label if needed, rather than inventing a second status client.

## Technical Considerations

- Data layer already supports this: `getWatches("archived")` in `lib/watches.ts`.
- Status toggle already exists: `PATCH /api/watches/[id]` with `{ status: "active" | "archived" }`.
- Detail route `getWatch(id)` already returns archived watches (no status filter).
- Manual refresh route already requires `status = 'active'`; UI should hide the button to match.
- No migration required; `watches.status` and `(user_id, status)` index already exist.
- Auth: gate the new page with `hasSession()` like `app/page.tsx`.

## Success Metrics

- User can reach archived watches in one click from any AppShell page
- User can restore an archived watch in one click from the archived list
- Restored watches reappear on the main dashboard without data loss
- No failed Refresh attempts from archived detail UI

## Open Questions

- None for this pass; decisions locked by product answers (separate page, simple list, redirect home, hide Refresh, full polish including list restore).
