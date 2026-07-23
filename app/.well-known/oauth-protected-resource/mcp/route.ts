import { protectedResourceMetadata } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(protectedResourceMetadata(), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "The remote CrownTracker MCP connector is not configured." }, { status: 503 });
  }
}
