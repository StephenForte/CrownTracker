import { db } from "@/lib/db";

const ownerEmail = "owner@crown-tracker.local";

export async function getOwnerId() {
  const result = await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [ownerEmail]);
  if (!result.rows[0]) throw new Error("Database is not initialized. Run npm run db:migrate.");
  return result.rows[0].id;
}

export { ownerEmail };
