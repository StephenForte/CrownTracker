"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/watches/${id}/refresh`, { method: "POST" });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setMessage(data.error ?? "Could not refresh this watch."); return; }
    setMessage(data.expanded ? "Market scan complete." : "Phase 1A-safe scan complete. Set the Phase 1B provider configuration to use expanded research.");
    router.refresh();
  }
  return <div className="refresh-control"><button className="secondary" type="button" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh now"}</button>{message && <span className="meta">{message}</span>}</div>;
}
