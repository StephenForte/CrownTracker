"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function WatchStatusButton({ id, status }: { id: string; status: "active" | "archived" }) {
  const [busy, setBusy] = useState(false); const router = useRouter();
  async function toggle() { setBusy(true); const response = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: status === "active" ? "archived" : "active" }) }); if (response.ok) { router.push("/"); router.refresh(); } else setBusy(false); }
  return <button className={status === "active" ? "danger" : "secondary"} type="button" onClick={toggle} disabled={busy}>{busy ? "Saving…" : status === "active" ? "Archive watch" : "Restore watch"}</button>;
}
