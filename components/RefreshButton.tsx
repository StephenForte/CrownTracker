"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefreshButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true); setMessage("");
    const response = await fetch(`/api/watches/${id}/refresh`, { method: "POST" });
    const data = await response.json() as { error?: string; expanded?: boolean; outcome?: { discovered: number; pagesRead: number; savedListings: number; scopeMatchedListings: number; scopeExcludedListings: number; groundingDrops: number; usedBaseReferenceFallback: boolean } }; setBusy(false);
    if (!response.ok) { setMessage(data.error ?? "Could not refresh this watch."); return; }
    if (!data.expanded) { setMessage("Phase 1A-safe scan complete. Set the Phase 1B provider configuration to use expanded research."); router.refresh(); return; }
    const outcome = data.outcome;
    if (!outcome) setMessage("Market scan complete.");
    else if (outcome.scopeMatchedListings > 0) setMessage(`Market scan complete: ${outcome.scopeMatchedListings} in-scope listing${outcome.scopeMatchedListings === 1 ? "" : "s"} from ${outcome.pagesRead} readable page${outcome.pagesRead === 1 ? "" : "s"}.`);
    else {
      const fallback = outcome.usedBaseReferenceFallback ? " A base-reference fallback was also searched." : "";
      setMessage(`No in-scope listings yet: ${outcome.discovered} discovered, ${outcome.pagesRead} readable, ${outcome.savedListings} retained, ${outcome.scopeExcludedListings} outside your scope, ${outcome.groundingDrops} ungrounded.${fallback}`);
    }
    router.refresh();
  }
  return <div className="refresh-control"><button className="secondary" type="button" onClick={refresh} disabled={busy}>{busy ? "Refreshing…" : "Refresh now"}</button>{message && <span className="meta">{message}</span>}</div>;
}
