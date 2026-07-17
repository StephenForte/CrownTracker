import { config } from "dotenv";

config({ path: ".env.local" });
config();

const tier = process.argv.find((argument) => argument.startsWith("--tier="))?.split("=")[1] ?? "daily";

async function main() {
  console.log(JSON.stringify({ event: "pipeline_started", tier, at: new Date().toISOString() }));
  if (!["daily", "chatter", "monthly"].includes(tier)) throw new Error(`Unknown pipeline tier: ${tier}`);
  const [{ db }, { getWatches }, { researchWatch }, { researchChatterWatch, researchNewsWatch, researchUncuratedSellers }, { checkLatestEvidenceLinks }, { evaluateEmailAlerts }] = await Promise.all([
    import("../lib/db"), import("../lib/watches"), import("../lib/research"), import("../lib/community-research"), import("../lib/link-health"), import("../lib/alerts"),
  ]);
  const watches = await getWatches("active");
  let failures = 0;
  async function runWatch(watch: Awaited<ReturnType<typeof getWatches>>[number], jobType: string, work: (runId: string) => Promise<{ discoveryQueries: number }>) {
    const created = await db.query<{ id: string }>("INSERT INTO runs (watch_id, job_type, status) VALUES ($1, $2, 'running') RETURNING id", [watch.id, jobType]);
    const runId = created.rows[0].id;
    try {
      const outcome = await work(runId);
      await db.query("UPDATE runs SET status = 'succeeded', finished_at = now(), queries_used = $1 WHERE id = $2", [outcome.discoveryQueries, runId]);
      console.log(JSON.stringify({ event: "watch_researched", watchId: watch.id, jobType, ...outcome }));
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : "Unknown pipeline error";
      await db.query("UPDATE runs SET status = 'failed', finished_at = now(), error = $1::jsonb WHERE id = $2", [JSON.stringify({ message }), runId]);
      console.error(JSON.stringify({ event: "watch_research_failed", watchId: watch.id, jobType, error: message }));
    }
  }
  if (tier === "daily") for (const watch of watches) await runWatch(watch, "price_scan", (runId) => researchWatch(db, watch, runId));
  if (tier === "chatter") for (const watch of watches) {
    await runWatch(watch, "chatter_scan", (runId) => researchChatterWatch(db, watch, runId));
    await runWatch(watch, "news_scan", (runId) => researchNewsWatch(db, watch, runId));
  }
  if (tier === "monthly") {
    const created = await db.query<{ id: string }>("INSERT INTO runs (job_type, status) VALUES ('seller_research', 'running') RETURNING id");
    try {
      const outcome = await researchUncuratedSellers(db, created.rows[0].id);
      await db.query("UPDATE runs SET status = 'succeeded', finished_at = now(), queries_used = $1 WHERE id = $2", [outcome.discoveryQueries, created.rows[0].id]);
      console.log(JSON.stringify({ event: "seller_research_finished", ...outcome }));
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : "Unknown pipeline error";
      await db.query("UPDATE runs SET status = 'failed', finished_at = now(), error = $1::jsonb WHERE id = $2", [JSON.stringify({ message }), created.rows[0].id]);
      console.error(JSON.stringify({ event: "seller_research_failed", error: message }));
    }
    const linkCheck = await db.query<{ id: string }>("INSERT INTO runs (job_type, status) VALUES ('link_check', 'running') RETURNING id");
    try {
      const outcome = await checkLatestEvidenceLinks(db, linkCheck.rows[0].id);
      await db.query("UPDATE runs SET status = 'succeeded', finished_at = now() WHERE id = $1", [linkCheck.rows[0].id]);
      console.log(JSON.stringify({ event: "link_check_finished", ...outcome }));
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : "Unknown link-check error";
      await db.query("UPDATE runs SET status = 'failed', finished_at = now(), error = $1::jsonb WHERE id = $2", [JSON.stringify({ message }), linkCheck.rows[0].id]);
      console.error(JSON.stringify({ event: "link_check_failed", error: message }));
    }
  }
  // Notifications are deliberately evaluated after each cron tier so the
  // state transition is based on committed snapshots/runs, never on a partial
  // in-memory result. Delivery failures are recorded independently and do not
  // erase or block the research work that just completed.
  try {
    const outcome = await evaluateEmailAlerts(db);
    console.log(JSON.stringify({ event: "alert_evaluation_finished", ...outcome }));
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : "Unknown alert evaluation error";
    console.error(JSON.stringify({ event: "alert_evaluation_failed", error: message }));
  }
  if (failures) throw new Error(`${failures} watch research run(s) failed.`);
  console.log(JSON.stringify({ event: "pipeline_finished", tier, status: "succeeded", at: new Date().toISOString() }));
}

main().catch((error) => { console.error(error); process.exit(1); });
