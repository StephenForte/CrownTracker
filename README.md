# Crown Tracker

Single-user Rolex market-tracking dashboard. It provides password-based access, Postgres-backed watch CRUD, a spec-lookup confirmation flow, and a daily, auditable market-research pipeline.

## Local setup

1. Copy `.env.example` to `.env.local` and set a real password and session secret.
2. Install [Postgres.app](https://postgresapp.com/), move it to Applications, open it, and click **Initialize**. It runs a local PostgreSQL server on `localhost:5432` using your macOS username with no password by default.
3. Add Postgres.app's command-line tools to your Bash PATH once:

   ```bash
   echo 'export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"' >> ~/.bash_profile
   source ~/.bash_profile
   ```

   Then create the app database:

   ```bash
   createdb crown_tracker
   ```

   The `DATABASE_URL` in `.env.local` should remain `postgresql://localhost:5432/crown_tracker`.
4. Run `npm install`, then `npm run db:migrate` and `npm run dev`.

To run the Phase 1A-safe daily research job locally, add `TAVILY_API_KEY` to `.env.local`, then run:

```bash
npm run pipeline -- --tier=daily
```

Phase 1B’s expanded price scan additionally requires `ANTHROPIC_API_KEY` and an intentional positive `TAVILY_MONTHLY_CREDIT_CAP`. The cap is **credits, not dollars**, and is atomically counted in Postgres before every search request; expanded (advanced) searches consume two credits each. At Tavily's current $0.008 PAYG rate, `1250` is approximately a $10 cap before any account-level free credits. Without both values the pipeline stays on the one-query Phase 1A-safe path. The detail page’s **Refresh now** action is limited to five scans per day.

The login is intentionally a single env-var password for this one-user app. It is not multi-user authentication.

## Phase 1 market research

The lookup catalog gives instant confirmation for common references. Its first source of record is Rolex official product information; the documented fallback for discontinued references is WatchBase.

Each daily job discovers pages only on curated seller domains and checks the destination's `robots.txt` before retrieving it. In Phase 1B mode it treats each structured Product row as a candidate, optionally fetches its permitted detail page to fill row-level attributes, grounds every retained price against the row/detail source text, normalizes currency to USD, and classifies scope as in-scope, out-of-scope, or uncertain. Unknown required details carry a 0.5 weight rather than being guessed.

The dashboard separates **Avg asking (grey)** (unworn) from **Avg asking (resell)** (pre-owned), applies IQR outlier removal before a weighted median, and surfaces confidence, staleness, evidence, availability, and curated-seller trust. Asking prices are not transaction prices.

## Deploy

Connect the repository to Render and apply `render.yaml`. Set `APP_PASSWORD` and `TAVILY_API_KEY`; set `TAVILY_MONTHLY_CREDIT_CAP` and `ANTHROPIC_API_KEY` only when you intend to enable paid Phase 1B scans. Render generates `SESSION_SECRET` and wires `DATABASE_URL`. The first release command should be `npm run db:migrate` (or run it from Render Shell) before using the app. The daily cron runs the research pipeline; the chatter and monthly jobs remain intentionally inert placeholders for later phases.
