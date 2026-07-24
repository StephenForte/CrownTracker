import { oauthAuthorizationMetadata } from "@/lib/mcp-oauth";
import { isMcpRemoteEnabled, mcpRemoteUnavailableResponse } from "@/lib/mcp-remote";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isMcpRemoteEnabled()) return mcpRemoteUnavailableResponse();
  try {
    return Response.json(oauthAuthorizationMetadata(), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return mcpRemoteUnavailableResponse();
  }
}
