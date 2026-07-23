import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mcpDb } from "@/lib/mcp-db";
import { createMetricsMcpServer } from "@/lib/mcp-server";
import { MCP_READ_SCOPE, protectedResourceMetadataUrl, verifyMcpBearer } from "@/lib/mcp-oauth";
import { isMcpRemoteEnabled, mcpRemoteUnavailableResponse } from "@/lib/mcp-remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function originIsAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const supportedClaudeOrigins = ["https://claude.ai", "https://www.claude.ai"];
  return [...supportedClaudeOrigins, ...configured].includes(origin);
}

async function handle(request: Request) {
  if (!isMcpRemoteEnabled()) return mcpRemoteUnavailableResponse();
  if (!originIsAllowed(request)) return Response.json({ error: "Origin is not allowed." }, { status: 403 });

  let metadataUrl: string;
  let reader;
  try {
    metadataUrl = protectedResourceMetadataUrl();
    reader = mcpDb();
  } catch {
    return mcpRemoteUnavailableResponse();
  }

  const authInfo = await verifyMcpBearer(request.headers.get("authorization"), reader);
  if (!authInfo) {
    return new Response(null, {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer realm="CrownTracker", resource_metadata="${metadataUrl}", scope="${MCP_READ_SCOPE}"` },
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createMetricsMcpServer(reader);
  await server.connect(transport);
  return transport.handleRequest(request, { authInfo });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
