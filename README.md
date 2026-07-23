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

Phase 1B’s expanded price scan requires all three of `PHASE1B_ENRICHMENT_ENABLED=true`, `ANTHROPIC_API_KEY`, and an intentional positive `TAVILY_MONTHLY_CREDIT_CAP`. Credentials alone do not enable it; an enabled but incomplete configuration fails the run rather than silently falling back. The cap is **credits, not dollars**, and is atomically counted in Postgres before every Phase 1B search request; expanded (advanced) searches consume two credits each. A focused Phase 1B scan makes five advanced searches (10 credits); an exact subvariant with no curated results may make one additional base-reference fallback search (12 credits total). At Tavily's current $0.008 PAYG rate, `1250` is approximately a $10 cap before any account-level free credits. Phase 2 uses the provider prerequisites but is independent of the Phase 1B flag. The detail page’s **Refresh now** action is limited to five scans per day.

The login is intentionally a single env-var password for this one-user app. It is not multi-user authentication.

## CoWork metrics MCP

`npm run mcp:metrics` starts a local stdio MCP server for a CoWork job. Its one read-only tool, `get_active_watch_metrics`, returns all active watches with the latest grey and resell **asking-price** estimates, availability, sample sizes, confidence, and freshness. It reads the same Postgres snapshots as the dashboard; it does not refresh research or call Tavily, Anthropic, or WatchBase.

The bundled personal plugin points CoWork at this repository's `tsx` runtime and loads `.env.local` before it opens the database. Keep the plugin local to the machine that has the CrownTracker database and dependencies. In a job, ask: “Use CrownTracker Metrics to report the active watches and their current metrics.” Missing metrics are returned as `null` / `Gathering`, never as zero.

## Phase 1 market research

The lookup catalog gives instant confirmation for common references. On the add-watch screen, search it by reference, model, nickname, or common alias (such as “Sprite” or “Explorer 2”). For an unlisted reference, **Look up archive** calls WatchBase only when pressed and presents up to eight Rolex candidates; selecting one makes one further explicit detail request and then pre-fills source-grounded basics, which must still be confirmed before saving. Set both `WATCHBASE_API_KEY` and an intentional `WATCHBASE_LOOKUP_MONTHLY_CREDIT_CAP` (start with `10`) to enable it. The cap is atomically counted in Postgres before every archive request, with no automatic retries or background calls. The local index now covers common Daytona, Submariner, GMT-Master II, Datejust, Oyster Perpetual, Explorer, Sea-Dweller, Yacht-Master, Sky-Dweller, Day-Date, Air-King, and Milgauss references. Only the four fully documented entries prefill market facts; identity-only matches deliberately leave specs and MSRP blank until confirmed. The catalog's first source of record is Rolex official product information; the documented fallback for discontinued references is WatchBase. Every tracked watch has a required nickname, which keeps the dashboard readable and adds a useful alias to research queries. Existing blank nicknames are backfilled by migration with a clearly editable `Reference <number> — <id>` placeholder.

Each daily job discovers pages only on curated seller domains and checks the destination's `robots.txt` before retrieving it. Phase 1A accepts structured Product/Offer candidates only, keeps year and warranty unknown, and does not call an LLM, fetch detail pages, or convert currencies. Phase 1B treats each structured Product row as a candidate, fetches a robots-permitted detail page only when a required scope attribute is still unknown, grounds retained values against the row/detail source text, normalizes currency to USD, and classifies scope as in-scope, out-of-scope, or uncertain. Unknown required details carry a 0.5 weight rather than being guessed.

Production-year limits are intentionally available only with Phase 1B. The UI and API hide/reject them in Phase 1A because that tier cannot reliably ground a listing's production year. Phase 1B already extracts a row-level year and, when needed, confirms it from a robots-permitted detail page before applying the saved year range; unknown years stay in the uncertain bucket rather than being treated as matches or exclusions.

The dashboard separates **Avg asking (grey)** (unworn) from **Avg asking (resell)** (pre-owned), applies IQR outlier removal before a weighted median, and surfaces confidence, staleness, evidence, availability, and curated-seller trust. Asking prices are not transaction prices.

## Phase 2 judgment layer

The Mon/Thu cron performs independent chatter and news runs for every active watch. Chatter keeps only dated, source-quoted wait-time anecdotes and models a recency-weighted 25th–75th percentile when at least three reports exist. Sentiment uses a fixed three-dimension rubric and requires three grounded quotes from distinct sources; it is never blended with price movement. News remains a short, source-linked reference-specific list. The monthly job researches only non-curated sellers whose cached score is over 30 days old; seed scores are never overwritten by model inference.

Every Phase 2 HTTP retrieval checks `robots.txt`, fails closed if it cannot be read, identifies CrownTracker, and is limited to one request per five seconds per domain. Source quotes remain capped at 300 characters. Dashboard filters support availability and biggest seven-day resell-price movement; scope changes are shown as history annotations without rewriting snapshots.

## Phase 3 hardening

The app is installable as a PWA. It intentionally does not cache authenticated pages or market data, so an installed app still loads fresh research and honors the current session.

The monthly job also checks up to 60 source URLs that support the current metric snapshots and have not been checked in 30 days. Each result is append-only, robots-aware, rate-limited per domain, and shown beside affected evidence when a source was unavailable; the retained quote remains available. URLs that robots disallow are recorded as unverified rather than labeled offline.

Cached listing pages and their expected extraction fields live in `tests/fixtures/`. `npm run test:extraction` verifies the deterministic extraction fixtures without provider cost. Before changing the Claude listing-extraction prompt, run `npm run verify:prompts` with `ANTHROPIC_API_KEY` set; it runs the same golden pages through the live grounding path and fails on an expected-field regression.

## Phase 3B reach

Each watch’s detail page can hold optional USD thresholds for its grey and resell **asking-price** estimates. A scheduled run sends one email when an estimate enters a configured above/below condition, then waits for it to return to normal before sending again. The same delivery path reports price research that is stale for 48 hours (and escalates at 96 hours), plus Tavily budget use at 80% and 100%. Every attempted delivery is retained in the append-only `alert_events` log; a delivery failure is recorded without discarding research results.

Email is opt-in. Verify a sending domain in Resend, then set `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, and `ALERT_TO_EMAIL` together on the web service and all three cron jobs. A missing set leaves alert delivery disabled; a partial set makes the run fail loudly rather than silently losing notifications. The new **Coverage** page reports each domain’s observed listings, active-watch coverage, retained evidence, and latest link-check result for the last 30 days. It never infers a fetch failure from absent data.

## Enabling the monthly cron

`crown-tracker-monthly` runs at 06:00 UTC on the first day of each month. It first researches up to 12 non-curated sellers whose trust evidence is absent or over 30 days old, then independently runs the append-only, robots-aware link-health check. Curated seed scores are never changed. When no seller is due, seller research is skipped without calling Tavily or Anthropic, and link health still runs.

Before enabling it in Render, configure the cron service itself with `DATABASE_URL`, `TAVILY_API_KEY`, `ANTHROPIC_API_KEY`, and an intentional positive `TAVILY_MONTHLY_CREDIT_CAP`. The provider values are required only when one or more sellers are due; the cap is checked in Postgres before every Tavily request. Keep `PHASE1B_ENRICHMENT_ENABLED` false unless you separately choose to enable expanded price research—it is not required by the monthly job. Trigger one manual run and confirm both `seller_research_finished` and `link_check_finished` appear in the logs; a zero-candidate seller result is expected on a clean queue.

## Deploy

Connect the repository to Render and apply `render.yaml`. Set `APP_PASSWORD` and `TAVILY_API_KEY`; to enable paid Phase 1B scans, set `PHASE1B_ENRICHMENT_ENABLED=true` together with `TAVILY_MONTHLY_CREDIT_CAP` and `ANTHROPIC_API_KEY` on the web and daily-cron services. Render generates `SESSION_SECRET` and wires `DATABASE_URL`. The first release command should be `npm run db:migrate` (or run it from Render Shell) before using the app. The daily cron runs pricing, Mon/Thu runs chatter and news, and the monthly job refreshes non-curated seller research and link health. Enable alerts only after adding the three Resend variables to every service.
