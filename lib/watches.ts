import { db } from "@/lib/db";
import { getOwnerId } from "@/lib/owner";
import { scopeSchema, type Scope } from "@/lib/watch-schema";

export type { Scope } from "@/lib/watch-schema";
export type Watch = { id: string; reference_number: string; model_name: string; nickname: string; specs: Record<string, string | number>; scope: Scope; photo_mime: string | null; photo_source_url: string | null; tracked_watch_url: string | null; retail_price_usd: string | null; discontinued: boolean; status: "active" | "archived"; notes: string | null; created_at: Date };

export async function getWatches(status?: "active" | "archived") {
  const userId = await getOwnerId();
  const result = await db.query<Watch>(`SELECT * FROM watches WHERE user_id = $1 ${status ? "AND status = $2" : ""} ORDER BY created_at DESC`, status ? [userId, status] : [userId]);
  return result.rows.map(normalizeWatch);
}

export async function getWatch(id: string) {
  const userId = await getOwnerId();
  const result = await db.query<Watch>("SELECT * FROM watches WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rows[0] ? normalizeWatch(result.rows[0]) : null;
}

function normalizeWatch(watch: Watch): Watch {
  return { ...watch, scope: scopeSchema.parse(watch.scope) };
}
