import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ConnectorRevokeButton, RevokeAllConnectorsButton } from "@/components/ConnectorRevokeControls";
import { listMcpConnectorClients } from "@/lib/mcp-oauth";
import { isMcpRemoteEnabled, isMcpRemoteRequested, mcpRemoteConfigurationError } from "@/lib/mcp-remote";

export const dynamic = "force-dynamic";

function formatWhen(value: Date | null) {
  return value ? value.toLocaleString() : "Never";
}

export default async function ConnectorsPage() {
  if (!(await hasSession())) redirect("/login");
  const enabled = isMcpRemoteEnabled();
  const requested = isMcpRemoteRequested();
  const configError = mcpRemoteConfigurationError();
  const clients = await listMcpConnectorClients();
  const active = clients.filter((client) => client.status === "active");

  return (
    <AppShell>
      <section className="detail-header">
        <div>
          <div className="eyebrow">Remote access</div>
          <h1>Connectors</h1>
          <p className="muted">
            External Claude/Cowork connectors that can read active-watch metrics. Changing <code>APP_PASSWORD</code> does not revoke tokens — use the controls below.
          </p>
        </div>
        <RevokeAllConnectorsButton disabled={!active.length} />
      </section>

      <section className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Remote MCP is {enabled ? "enabled" : requested ? "requested but misconfigured" : "disabled"}.
          {!enabled && requested && configError ? ` ${configError}` : null}
          {!requested ? " Set MCP_REMOTE_ENABLED=true with MCP_PUBLIC_BASE_URL and MCP_DATABASE_URL to accept new grants." : null}
        </p>
      </section>

      {!clients.length ? (
        <section className="panel">
          <p className="muted" style={{ margin: 0 }}>No connector grants yet.</p>
        </section>
      ) : (
        <section className="panel coverage-table connectors-table">
          <div className="coverage-row coverage-head">
            <span>Connector</span>
            <span>Redirect origin</span>
            <span>Issued</span>
            <span>Last used</span>
            <span>Status</span>
            <span />
          </div>
          {clients.map((client) => (
            <div className="coverage-row" key={client.clientId}>
              <div>
                <strong>{client.clientName ?? "Unnamed connector"}</strong>
                <small>{client.activeTokenCount} active refresh grant{client.activeTokenCount === 1 ? "" : "s"}</small>
              </div>
              <span>{client.redirectOrigin}</span>
              <span>{formatWhen(client.createdAt)}</span>
              <span>{formatWhen(client.lastUsedAt)}</span>
              <span>{client.status}</span>
              <span>
                {client.status === "active" ? (
                  <ConnectorRevokeButton clientId={client.clientId} clientLabel={client.clientName ?? client.redirectOrigin} />
                ) : null}
              </span>
            </div>
          ))}
        </section>
      )}
    </AppShell>
  );
}
