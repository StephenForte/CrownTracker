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

To run the Phase 1 daily research job locally, add `TAVILY_API_KEY` to `.env.local`, then run:

```bash
npm run pipeline -- --tier=daily
```

The login is intentionally a single env-var password for this one-user app. It is not multi-user authentication.

## Phase 1 market research

The lookup catalog gives instant confirmation for common references. Its first source of record is Rolex official product information; the documented fallback for discontinued references is WatchBase.

Each daily job discovers pages only on the curated seller domains, checks the destination's `robots.txt` before retrieving it, and accepts a listing only when the page contains structured Product/Offer pricing. The job stores each observed price and a per-watch market snapshot. It does not use browser automation, authenticated scraping, currency conversion, or LLM extraction.

The dashboard includes only USD listings that meet the watch's saved condition, papers, box, warranty, and production-year requirements. When a required detail is absent, the listing is deliberately excluded rather than guessed.

## Deploy

Connect the repository to Render and apply `render.yaml`. Set `APP_PASSWORD` and `TAVILY_API_KEY`; Render generates `SESSION_SECRET` and wires `DATABASE_URL`. The first release command should be `npm run db:migrate` (or run it from Render Shell) before using the app. The daily cron runs the research pipeline; the chatter and monthly jobs remain intentionally inert placeholders for later phases.
