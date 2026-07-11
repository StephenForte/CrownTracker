CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  reference_number text NOT NULL,
  model_name text NOT NULL,
  nickname text,
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  photo bytea,
  photo_mime text,
  photo_source_url text,
  retail_price_usd numeric(12,2),
  discontinued boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id uuid REFERENCES watches(id),
  job_type text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'succeeded',
  queries_used integer NOT NULL DEFAULT 0,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  est_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  error jsonb
);

CREATE TABLE IF NOT EXISTS sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  domain text NOT NULL UNIQUE,
  platform text,
  jurisdiction text,
  trust_score integer CHECK (trust_score BETWEEN 0 AND 100),
  trust_rationale text,
  curated boolean NOT NULL DEFAULT false,
  jurisdiction_modifier integer NOT NULL DEFAULT 0,
  last_researched_at timestamptz
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watches_user_status_idx ON watches(user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS watches_user_reference_nickname_idx ON watches(user_id, reference_number, COALESCE(nickname, ''));
CREATE INDEX IF NOT EXISTS runs_watch_started_idx ON runs(watch_id, started_at DESC);
