"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConnectorRevokeButton({ clientId, clientLabel }: { clientId: string; clientLabel: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function revoke() {
    if (!window.confirm(`Revoke access for ${clientLabel}? Every access and refresh token for this connector becomes invalid immediately.`)) return;
    setBusy(true);
    const response = await fetch(`/api/mcp/clients/${encodeURIComponent(clientId)}`, { method: "DELETE" });
    if (response.ok) router.refresh();
    else setBusy(false);
  }

  return <button className="danger" type="button" onClick={revoke} disabled={busy}>{busy ? "Revoking…" : "Revoke"}</button>;
}

export function RevokeAllConnectorsButton({ disabled }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function revokeAll() {
    if (!window.confirm("Revoke every CrownTracker connector? All current access and refresh tokens become invalid immediately.")) return;
    setBusy(true);
    const response = await fetch("/api/mcp/clients", { method: "DELETE" });
    if (response.ok) router.refresh();
    else setBusy(false);
  }

  return <button className="danger" type="button" onClick={revokeAll} disabled={disabled || busy}>{busy ? "Revoking…" : "Revoke all connectors"}</button>;
}
