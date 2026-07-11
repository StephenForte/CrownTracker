import { db } from "@/lib/db";

export type Scope = { condition: "any" | "unworn" | "pre_owned"; yearMin?: number | null; yearMax?: number | null; papers: "required" | "not_required"; box: "required" | "not_required"; warranty: "factory_remaining" | "third_party_ok" | "none_ok" };
export type Watch = { id: string; reference_number: string; model_name: string; nickname: string | null; specs: Record<string, string | number>; scope: Scope; photo_source_url: string | null; retail_price_usd: string | null; discontinued: boolean; status: "active" | "archived"; notes: string | null; created_at: Date };

async function ownerId() {
  const result = await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", ["owner@crown-tracker.local"]);
  if (!result.rows[0]) throw new Error("Database is not initialized. Run npm run db:migrate.");
  return result.rows[0].id;
}

export async function getWatches(status?: "active" | "archived") {
  const userId = await ownerId();
  const result = await db.query<Watch>(`SELECT * FROM watches WHERE user_id = $1 ${status ? "AND status = $2" : ""} ORDER BY created_at DESC`, status ? [userId, status] : [userId]);
  return result.rows;
}

export async function getWatch(id: string) {
  const userId = await ownerId();
  const result = await db.query<Watch>("SELECT * FROM watches WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rows[0] ?? null;
}
