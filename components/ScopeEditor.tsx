"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { Scope } from "@/lib/watches";

export function ScopeEditor({ id, scope, phase1bEnabled }: { id: string; scope: Scope; phase1bEnabled: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  if (!phase1bEnabled && (scope.yearMin !== null || scope.yearMax !== null || scope.warranty !== "none_ok")) return <p className="muted">This saved year or warranty requirement is inactive until Phase 1B enrichment is enabled.</p>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); const form = new FormData(event.currentTarget);
    const year = (name: string) => { const value = String(form.get(name) ?? ""); return value ? Number(value) : null; };
    const identityTerms = String(form.get("identityTerms") ?? "").split(",").map((term) => term.trim()).filter(Boolean);
    try {
      const response = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: { condition: form.get("condition"), papers: form.get("papers"), box: form.get("box"), warranty: phase1bEnabled ? form.get("warranty") : "none_ok", yearMin: phase1bEnabled ? year("yearMin") : null, yearMax: phase1bEnabled ? year("yearMax") : null, identityTerms } }) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Could not update scope (HTTP ${response.status}).`);
        return;
      }
      setOpen(false); router.refresh();
    } catch {
      setError("Could not reach CrownTracker to save this scope. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  if (!open) return <button className="secondary" type="button" onClick={() => setOpen(true)}>Edit scope</button>;
  return <form onSubmit={submit} style={{ marginTop: 18 }}><div className="form-grid"><div className="field"><label>Condition</label><select name="condition" defaultValue={scope.condition}><option value="any">Any condition</option><option value="unworn">Unworn</option><option value="pre_owned">Pre-owned</option></select></div><div className="field"><label>Papers</label><select name="papers" defaultValue={scope.papers}><option value="required">Required</option><option value="not_required">Not required</option></select></div>{phase1bEnabled && <><div className="field"><label>From year</label><input name="yearMin" type="number" defaultValue={scope.yearMin ?? ""} /></div><div className="field"><label>To year</label><input name="yearMax" type="number" defaultValue={scope.yearMax ?? ""} /></div></>}<div className="field"><label>Box</label><select name="box" defaultValue={scope.box}><option value="not_required">Not required</option><option value="required">Required</option></select></div>{phase1bEnabled && <div className="field"><label>Warranty</label><select name="warranty" defaultValue={scope.warranty}><option value="factory_remaining">Factory warranty required</option><option value="third_party_ok">Factory or third-party accepted</option><option value="none_ok">No warranty requirement</option></select></div>}<div className="field wide"><label>Required listing identity terms</label><input name="identityTerms" defaultValue={scope.identityTerms.join(", ")} placeholder="e.g. factory baguette, grey dial" maxLength={300} /><span className="field-hint">Optional comma-separated terms required in listing evidence. The reference itself is always required.</span></div></div><div style={{ marginTop: 14 }}><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save scope"}</button><button className="secondary" style={{ marginLeft: 8 }} type="button" onClick={() => setOpen(false)}>Cancel</button>{error && <p className="error">{error}</p>}</div></form>;
}
