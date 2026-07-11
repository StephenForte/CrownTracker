# Crown Tracker

Phase 0 of a single-user Rolex market-tracking dashboard. It provides password-based access, Postgres-backed watch CRUD, a spec-lookup confirmation flow, Render deployment configuration, and the future pipeline's CLI seam.

## Local setup

1. Copy `.env.example` to `.env.local` and set a real password and session secret.
2. Start Postgres locally and set `DATABASE_URL`.
3. Run `npm install`, then `npm run db:migrate` and `npm run dev`.

The login is intentionally a single env-var password for this one-user Phase 0 app. It is not multi-user authentication.

## Data and source policy

The Phase 0 lookup catalog gives instant confirmation for common references. Its first source of record is Rolex official product information; the documented fallback for discontinued references is WatchBase. Phase 1 will use Tavily discovery plus robots-respecting HTTP retrieval to refresh and validate this information. No browser automation or credentialed scraping is included.

`npm run pipeline -- --tier=daily` is deliberately a logged no-op today. Render Cron Jobs run that exact command, so Phase 1 can add pipeline work without changing deployment architecture.

## Deploy

Connect the repository to Render and apply `render.yaml`. Set `APP_PASSWORD`; Render generates `SESSION_SECRET` and wires `DATABASE_URL`. The first release command should be `npm run db:migrate` (or run it from Render Shell) before using the app.
