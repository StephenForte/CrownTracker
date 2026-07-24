import { exchangeAuthorizationCode, refreshAccessToken } from "@/lib/mcp-oauth";
import { isMcpRemoteEnabled, mcpRemoteUnavailableResponse } from "@/lib/mcp-remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: string, description: string, status = 400) {
  return Response.json({ error, error_description: description }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isMcpRemoteEnabled()) return mcpRemoteUnavailableResponse();
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) return errorResponse("invalid_request", "The token endpoint requires form-encoded input.");
  const form = await request.formData();
  const grantType = String(form.get("grant_type") ?? "");
  const clientId = String(form.get("client_id") ?? "");
  if (!clientId) return errorResponse("invalid_request", "client_id is required.");
  try {
    if (grantType === "authorization_code") {
      const code = String(form.get("code") ?? "");
      const redirectUri = String(form.get("redirect_uri") ?? "");
      const codeVerifier = String(form.get("code_verifier") ?? "");
      if (!code || !redirectUri || !codeVerifier) return errorResponse("invalid_request", "code, redirect_uri, and code_verifier are required.");
      const result = await exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier, resource: form.get("resource") ? String(form.get("resource")) : null });
      if ("error" in result) return errorResponse(result.error.error, result.error.description);
      return Response.json(result, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
    }
    if (grantType === "refresh_token") {
      const refreshToken = String(form.get("refresh_token") ?? "");
      if (!refreshToken) return errorResponse("invalid_request", "refresh_token is required.");
      const result = await refreshAccessToken({ refreshToken, clientId, resource: form.get("resource") ? String(form.get("resource")) : null });
      if ("error" in result) return errorResponse(result.error.error, result.error.description);
      return Response.json(result, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
    }
    return errorResponse("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
  } catch {
    return errorResponse("server_error", "The token service is temporarily unavailable.", 503);
  }
}
