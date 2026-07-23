import { registerPublicClient } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await request.json() as { redirect_uris?: unknown; client_name?: unknown };
  } catch {
    return Response.json({ error: "invalid_client_metadata", error_description: "Client registration requires a JSON body." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await registerPublicClient({ redirectUris: body.redirect_uris, clientName: body.client_name });
    if ("error" in result && result.error) return Response.json({ error: result.error.error, error_description: result.error.description }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "server_error", error_description: "Client registration is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
