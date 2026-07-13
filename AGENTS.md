# Crown Tracker engineering guide

## Product boundaries

- This is a single-user, personal Rolex research dashboard. Do not introduce multi-user accounts, billing, sharing, queues, Redis, object storage, browser automation, or credentialed page scraping without an explicit product decision.
- Keep the deployment footprint to Next.js, Render Cron Jobs, Render Postgres, Tavily, Anthropic, and a keyless FX feed. Prefer a small module over a new dependency or service.
- The app may link to listings but must never facilitate checkout, payment, or escrow.

## Data integrity and research rules

- Treat listings, evidence, runs, and metric snapshots as append-only. Never erase market history when a scope changes; record the change and reclassify on the next scan.
- A listing attribute is valid only if it is grounded in that listing row or its robots-permitted detail page. Do not infer a year, warranty, or condition from collection-wide or dealer-wide copy.
- Keep source quotes at 300 characters or fewer, preserve their URL/domain/retrieval time, and show confidence, sample size, and freshness with every derived metric.
- Use `UNCERTAIN_LISTING_WEIGHT` for listings with unknown required scope attributes. Do not silently turn unknown into a match or a failure.
- Respect `robots.txt`, fail closed when it cannot be read, use the honest CrownTracker user-agent, stay at one request per five seconds per domain, and do not add headless browsers, proxies, CAPTCHA bypassing, or logged-in scraping.
- Asking and sold prices are separate series. Never label an asking-price median as a transaction price.

## Cost and operational safety

- Expanded Phase 1B search runs require both `TAVILY_MONTHLY_CREDIT_CAP` and `ANTHROPIC_API_KEY`. Keep the database-backed cap check before every Tavily request.
- Manual price refreshes are limited by `DAILY_MANUAL_REFRESH_LIMIT`; preserve that guard whenever changing the route or pipeline.
- Each pipeline watch run must catch and record failure independently so one bad source does not stop the remaining watches.

## Code conventions

- Use TypeScript strictly. Validate client/API input with Zod, parameterize all SQL, and keep DB access in `lib/`.
- Prefer small, testable pure helpers for calculations (confidence, scope classification, weighted median, staleness). Keep named product constants in `lib/phase1b.ts` rather than magic numbers in UI or SQL.
- Preserve existing user changes in a dirty worktree. Do not reset, overwrite, or reformat unrelated files.
- Add migrations instead of editing applied migrations. Migrations must be idempotent where practical and compatible with existing Phase 1A data.

## Verification and handoff

- Run `npm run typecheck` and `npm run build` for app changes. Run `npm run db:migrate` against a disposable/local database when a migration changes.
- Update `.env.example`, `render.yaml`, and `README.md` whenever required configuration or operations change.
- In review notes, call out any unverified external-source behavior, paid-provider prerequisite, or policy/ToS coverage gap rather than guessing.
