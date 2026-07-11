"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { Scope } from "@/lib/watches";

export function ScopeEditor({ id, scope }: { id: string; scope: Scope }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); const form = new FormData(event.currentTarget);
    const year = (name: string) => { const value = String(form.get(name) ?? ""); return value ? Number(value) : null; };
    const response = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: { condition: form.get("condition"), papers: form.get("papers"), box: form.get("box"), warranty: form.get("warranty"), yearMin: year("yearMin"), yearMax: year("yearMax") } }) });
    setSaving(false); if (!response.ok) { const data = await response.json(); return setError(data.error ?? "Could not update scope."); } setOpen(false); router.refresh();
  }
  if (!open) return <button className="secondary" type="button" onClick={() => setOpen(true)}>Edit scope</button>;
  return <form onSubmit={submit} style={{ marginTop: 18 }}><div className="form-grid"><div className="field"><label>Condition</label><select name="condition" defaultValue={scope.condition}><option value="any">Any condition</option><option value="unworn">Unworn</option><option value="pre_owned">Pre-owned</option></select></div><div className="field"><label>Papers</label><select name="papers" defaultValue={scope.papers}><option value="required">Required</option><option value="not_required">Not required</option></select></div><div className="field"><label>From year</label><input name="yearMin" type="number" defaultValue={scope.yearMin ?? ""} /></div><div className="field"><label>To year</label><input name="yearMax" type="number" defaultValue={scope.yearMax ?? ""} /></div><div className="field"><label>Box</label><select name="box" defaultValue={scope.box}><option value="not_required">Not required</option><option value="required">Required</option></select></div><div className="field"><label>Warranty</label><select name="warranty" defaultValue={scope.warranty}><option value="factory_remaining">Factory remaining</option><option value="third_party_ok">Third-party accepted</option><option value="none_ok">No warranty accepted</option></select></div></div><div style={{ marginTop: 14 }}><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save scope"}</button><button className="secondary" style={{ marginLeft: 8 }} type="button" onClick={() => setOpen(false)}>Cancel</button>{error && <p className="error">{error}</p>}</div></form>;
}
