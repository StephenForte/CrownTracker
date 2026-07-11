import { config } from "dotenv";

config({ path: ".env.local" });
config();

const tier = process.argv.find((argument) => argument.startsWith("--tier="))?.split("=")[1] ?? "daily";

async function main() {
  console.log(JSON.stringify({ event: "pipeline_started", tier, at: new Date().toISOString() }));
  if (tier !== "daily") {
    console.log(JSON.stringify({ event: "pipeline_skipped", tier, message: "Phase 1 schedules listing research only in the daily tier." }));
    return;
  }
  const [{ db }, { getWatches }, { researchWatch }] = await Promise.all([
    import("../lib/db"), import("../lib/watches"), import("../lib/research"),
  ]);
  const watches = await getWatches("active");
  let failures = 0;
  for (const watch of watches) {
    const created = await db.query<{ id: string }>("INSERT INTO runs (watch_id, job_type, status) VALUES ($1, $2, 'running') RETURNING id", [watch.id, tier]);
    const runId = created.rows[0].id;
    try {
      const outcome = await researchWatch(db, watch, runId);
      await db.query("UPDATE runs SET status = 'succeeded', finished_at = now(), queries_used = $1 WHERE id = $2", [outcome.discoveryQueries, runId]);
      console.log(JSON.stringify({ event: "watch_researched", watchId: watch.id, ...outcome }));
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : "Unknown pipeline error";
      await db.query("UPDATE runs SET status = 'failed', finished_at = now(), error = $1::jsonb WHERE id = $2", [JSON.stringify({ message }), runId]);
      console.error(JSON.stringify({ event: "watch_research_failed", watchId: watch.id, error: message }));
    }
  }
  if (failures) throw new Error(`${failures} watch research run(s) failed.`);
  console.log(JSON.stringify({ event: "pipeline_finished", tier, status: "succeeded", at: new Date().toISOString() }));
}

main().catch((error) => { console.error(error); process.exit(1); });
