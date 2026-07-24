import {
  authorizationFailureBlocked,
  completeAuthorizationPasswordAttempt,
  createAuthorizationCode,
  MCP_READ_SCOPE,
  type AuthorizationRequest,
  validateAuthorizationRequest,
} from "@/lib/mcp-oauth";
import {
  authorizePageSecurityHeaders,
  isMcpRemoteEnabled,
  MCP_REFRESH_TOKEN_LIFETIME_SECONDS,
  mcpRemoteUnavailableResponse,
} from "@/lib/mcp-remote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function refreshGrantDays() {
  return Math.round(MCP_REFRESH_TOKEN_LIFETIME_SECONDS / (24 * 60 * 60));
}

function formPage(request: AuthorizationRequest, error?: string) {
  const fields: Array<[string, string]> = [
    ["response_type", "code"],
    ["client_id", request.clientId],
    ["redirect_uri", request.redirectUri],
    ["code_challenge", request.codeChallenge],
    ["code_challenge_method", "S256"],
    ["scope", request.scope.join(" ")],
    ["resource", request.resource],
  ];
  if (request.state) fields.push(["state", request.state]);
  const hidden = fields.map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join("");
  const clientLabel = request.clientName ? escapeHtml(request.clientName) : "an unnamed connector";
  const destination = escapeHtml(request.redirectOrigin);
  const errorMarkup = error ? `<p style="color:#b42318">${escapeHtml(error)}</p>` : "";
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Authorize CrownTracker</title>
</head>
<body style="font-family:Georgia,serif;max-width:36rem;margin:3.5rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a">
  <h1 style="font-size:1.75rem;margin-bottom:0.5rem">Authorize CrownTracker Metrics</h1>
  <p style="margin-top:0">Connector <strong>${clientLabel}</strong> is requesting read-only access.</p>
  <p style="padding:0.85rem 1rem;background:#f4f4f0;border:1px solid #d8d8d0">
    Authorization codes will be sent only to<br>
    <strong style="font-size:1.1rem">${destination}</strong>
  </p>
  <ul>
    <li>Scope: <code>${escapeHtml(MCP_READ_SCOPE)}</code> (read-only active-watch metrics)</li>
    <li>Refresh grants last ${refreshGrantDays()} days and rotate on use</li>
    <li>Revoke anytime from CrownTracker → Connectors</li>
  </ul>
  <p>This connector cannot refresh research, call paid providers, or change your collection.</p>
  ${errorMarkup}
  <form method="post">
    ${hidden}
    <label style="display:block;margin:1rem 0">
      <input type="checkbox" name="confirm_destination" value="1" required>
      I confirm access may be granted to <strong>${destination}</strong>
    </label>
    <label style="display:block;margin:1rem 0 0.5rem">App password<br>
      <input name="password" type="password" required autofocus style="width:100%;margin-top:0.4rem;padding:0.65rem;box-sizing:border-box">
    </label>
    <button type="submit" style="margin-top:0.75rem;padding:0.7rem 1rem">Allow read-only access</button>
  </form>
</body>
</html>`,
    { headers: authorizePageSecurityHeaders() },
  );
}

function errorPage(error: string, description: string, status = 400) {
  return new Response(
    `<!doctype html><title>Authorization error</title><h1>Authorization error</h1><p>${escapeHtml(description)}</p><small>${escapeHtml(error)}</small>`,
    { status, headers: authorizePageSecurityHeaders() },
  );
}

function asSearchParams(entries: FormData) {
  const params = new URLSearchParams();
  for (const [key, value] of entries) if (typeof value === "string") params.set(key, value);
  return params;
}

export async function GET(request: Request) {
  if (!isMcpRemoteEnabled()) return mcpRemoteUnavailableResponse();
  try {
    const authorization = await validateAuthorizationRequest(new URL(request.url).searchParams);
    return "error" in authorization ? errorPage(authorization.error, authorization.description) : formPage(authorization);
  } catch {
    return errorPage("server_error", "CrownTracker authorization is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  if (!isMcpRemoteEnabled()) return mcpRemoteUnavailableResponse();
  const form = await request.formData();
  try {
    if (await authorizationFailureBlocked(request)) {
      return errorPage("temporarily_unavailable", "Too many failed authorization attempts. Try again later.", 429);
    }
    const authorization = await validateAuthorizationRequest(asSearchParams(form));
    if ("error" in authorization) return errorPage(authorization.error, authorization.description);
    if (String(form.get("confirm_destination") ?? "") !== "1") {
      return formPage(authorization, "Confirm the exact redirect destination before continuing.");
    }
    const expected = process.env.APP_PASSWORD ?? "";
    const provided = String(form.get("password") ?? "");
    const passwordAttempt = await completeAuthorizationPasswordAttempt(request, provided, expected);
    if (passwordAttempt === "blocked") {
      return errorPage("temporarily_unavailable", "Too many failed authorization attempts. Try again later.", 429);
    }
    if (passwordAttempt === "mismatch") {
      return formPage(authorization, "That password did not match.");
    }
    const code = await createAuthorizationCode(authorization);
    const redirect = new URL(authorization.redirectUri);
    redirect.searchParams.set("code", code);
    if (authorization.state) redirect.searchParams.set("state", authorization.state);
    return Response.redirect(redirect, 303);
  } catch {
    return errorPage("server_error", "CrownTracker authorization is temporarily unavailable.", 503);
  }
}
