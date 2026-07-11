import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var crownTrackerPool: Pool | undefined;
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Add it to .env.local or configure it in Render.");
}

export const db = global.crownTrackerPool ?? new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") global.crownTrackerPool = db;
