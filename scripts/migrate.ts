import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

type Seller = { name: string; domain: string; platform: string; jurisdiction: string; trustScore: number };
type Jurisdiction = { code: string; modifier: number; note: string };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = (await readdir(path.join(process.cwd(), "db/migrations"))).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (applied.rowCount) continue;
      await client.query("BEGIN");
      await client.query(await readFile(path.join(process.cwd(), "db/migrations", file), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    }

    await client.query("INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", ["owner@crown-tracker.local"]);
    const sellers: Seller[] = JSON.parse(await readFile(path.join(process.cwd(), "data/curated-sellers.json"), "utf8"));
    for (const seller of sellers) {
      await client.query(
        `INSERT INTO sellers (name, domain, platform, jurisdiction, trust_score, curated)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name, platform = EXCLUDED.platform,
           jurisdiction = EXCLUDED.jurisdiction, trust_score = EXCLUDED.trust_score, curated = true`,
        [seller.name, seller.domain, seller.platform, seller.jurisdiction, seller.trustScore],
      );
    }
    const jurisdictions: Jurisdiction[] = JSON.parse(await readFile(path.join(process.cwd(), "data/jurisdictions.json"), "utf8"));
    await client.query(
      "INSERT INTO settings (key, value) VALUES ('jurisdictions', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [JSON.stringify(jurisdictions)],
    );
    console.log("Seeded owner, curated sellers, and jurisdiction defaults.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
