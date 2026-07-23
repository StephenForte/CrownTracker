import { createAuthorizationCode, type AuthorizationRequest, validateAuthorizationRequest } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function formPage(request: AuthorizationRequest, error?: string) {
  const fields: Array<[string, string]> = [
    ["response_type", "code"], ["client_id", request.clientId], ["redirect_uri", request.redirectUri],
    ["code_challenge", request.codeChallenge], ["code_challenge_method", "S256"], ["scope", request.scope.join(" ")], ["resource", request.resource],
  ];
  if (request.state) fields.push(["state", request.state]);
  const hidden = fields.map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join("");
  const clientLabel = request.clientName ? ` for ${escapeHtml(request.clientName)}` : "";
  const errorMarkup = error ? `<p style="color:#b42318">${escapeHtml(error)}</p>` : "";
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize CrownTracker</title></head><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem"><h1>Authorize CrownTracker Metrics</h1><p>Allow this read-only connector${clientLabel} to see your active watches and their market metrics. It cannot refresh research or modify your collection.</p>${errorMarkup}<form method="post">${hidden}<label>Password<br><input name="password" type="password" required autofocus style="width:100%;margin:0.5rem 0 1rem;padding:0.6rem"></label><button type="submit">Allow read-only access</button></form></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } });
}

function errorPage(error: string, description: string) {
  return new Response(`<!doctype html><title>Authorization error</title><h1>Authorization error</h1><p>${escapeHtml(description)}</p><small>${escapeHtml(error)}</small>`, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function asSearchParams(entries: FormData) {
  const params = new URLSearchParams();
  for (const [key, value] of entries) if (typeof value === "string") params.set(key, value);
  return params;
}

export async function GET(request: Request) {
  try {
    const authorization = await validateAuthorizationRequest(new URL(request.url).searchParams);
    return "error" in authorization ? errorPage(authorization.error, authorization.description) : formPage(authorization);
  } catch {
    return errorPage("server_error", "CrownTracker authorization is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  try {
    const authorization = await validateAuthorizationRequest(asSearchParams(form));
    if ("error" in authorization) return errorPage(authorization.error, authorization.description);
    if (!process.env.APP_PASSWORD || String(form.get("password") ?? "") !== process.env.APP_PASSWORD) return formPage(authorization, "That password did not match.");
    const code = await createAuthorizationCode(authorization);
    const redirect = new URL(authorization.redirectUri);
    redirect.searchParams.set("code", code);
    if (authorization.state) redirect.searchParams.set("state", authorization.state);
    return Response.redirect(redirect, 303);
  } catch {
    return errorPage("server_error", "CrownTracker authorization is temporarily unavailable.");
  }
}
