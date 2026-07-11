"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Draft = { referenceNumber: string; modelName: string; nickname: string; retailPriceUsd: number | null; discontinued: boolean; photoSourceUrl: string | null; specs: { caseSizeMm?: number; dial?: string; bezel?: string; bracelet?: string; movement?: string; material?: string }; source: { name: string; url: string; note: string } };

const blank = { referenceNumber: "", modelName: "", nickname: "", retailPriceUsd: null as number | null, discontinued: false, photoSourceUrl: null as string | null, specs: {} as Draft["specs"] };

export function NewWatchForm() {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function lookup() {
    setError("");
    const response = await fetch(`/api/spec-lookup?reference=${encodeURIComponent(reference)}`);
    const data = await response.json();
    if (!response.ok) return setError(data.error ?? "Could not look up that reference.");
    setDraft(data); setForm({ referenceNumber: data.referenceNumber, modelName: data.modelName, nickname: data.nickname, retailPriceUsd: data.retailPriceUsd, discontinued: data.discontinued, photoSourceUrl: data.photoSourceUrl, specs: data.specs });
  }

  function update(key: string, value: string | number | boolean | null) { setForm((current) => ({ ...current, [key]: value })); }
  function updateSpec(key: string, value: string | number | null) { setForm((current) => ({ ...current, specs: { ...current.specs, [key]: value } })); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const fields = new FormData(event.currentTarget);
    const numberOrNull = (key: string) => { const value = String(fields.get(key) ?? "").trim(); return value ? Number(value) : null; };
    const payload = { ...form, modelName: form.modelName.trim(), nickname: form.nickname.trim(), retailPriceUsd: form.retailPriceUsd === null ? null : Number(form.retailPriceUsd), specs: { ...form.specs, caseSizeMm: form.specs.caseSizeMm ? Number(form.specs.caseSizeMm) : null }, scope: { condition: String(fields.get("condition")), yearMin: numberOrNull("yearMin"), yearMax: numberOrNull("yearMax"), papers: String(fields.get("papers")), box: String(fields.get("box")), warranty: String(fields.get("warranty")) }, notes: String(fields.get("notes") ?? "") };
    const response = await fetch("/api/watches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json(); setSaving(false);
    if (!response.ok) return setError(data.error ?? "Could not save this watch.");
    router.push(`/watches/${data.id}`); router.refresh();
  }

  return <form onSubmit={submit}><section className="panel"><div className="eyebrow">Step 1</div><h2>Look up the reference</h2><p className="muted">Start with a Rolex reference number. Confirm every returned field before saving.</p><div className="lookup"><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="e.g. 126500LN" aria-label="Rolex reference number" /><button type="button" onClick={lookup} disabled={!reference.trim()}>Look up specs</button></div>{draft && <div className="confirmation"><h2>{form.modelName || "Reference not in the starter catalog"}</h2><p>{form.modelName ? `Reference ${form.referenceNumber}${form.nickname ? ` · ${form.nickname}` : ""}. Is this right? You can edit it below.` : `We found no starter-catalog match for ${form.referenceNumber}. Complete and confirm the details manually.`}</p><p className="source">Source: <a href={draft.source.url} target="_blank" rel="noreferrer">{draft.source.name}</a> — {draft.source.note}</p></div>}</section>{draft && <><section className="panel" style={{ marginTop: 16 }}><div className="eyebrow">Step 2</div><h2>Confirm identity and specs</h2><div className="form-grid"><div className="field"><label>Reference number</label><input value={form.referenceNumber} onChange={(event) => update("referenceNumber", event.target.value)} required /></div><div className="field"><label>Model name</label><input value={form.modelName} onChange={(event) => update("modelName", event.target.value)} required /></div><div className="field"><label>Nickname</label><input value={form.nickname} onChange={(event) => update("nickname", event.target.value)} placeholder="Panda" /></div><div className="field"><label>Retail price (USD)</label><input type="number" min="0" value={form.retailPriceUsd ?? ""} onChange={(event) => update("retailPriceUsd", event.target.value ? Number(event.target.value) : null)} /></div><div className="field"><label>Case size (mm)</label><input type="number" min="1" value={form.specs.caseSizeMm ?? ""} onChange={(event) => updateSpec("caseSizeMm", event.target.value ? Number(event.target.value) : null)} /></div><div className="field"><label>Dial</label><input value={form.specs.dial ?? ""} onChange={(event) => updateSpec("dial", event.target.value)} /></div><div className="field"><label>Bezel</label><input value={form.specs.bezel ?? ""} onChange={(event) => updateSpec("bezel", event.target.value)} /></div><div className="field"><label>Bracelet</label><input value={form.specs.bracelet ?? ""} onChange={(event) => updateSpec("bracelet", event.target.value)} /></div><div className="field"><label>Movement</label><input value={form.specs.movement ?? ""} onChange={(event) => updateSpec("movement", event.target.value)} /></div><div className="field"><label>Material</label><input value={form.specs.material ?? ""} onChange={(event) => updateSpec("material", event.target.value)} /></div><div className="field"><label><input style={{ width: "auto", marginRight: 8 }} type="checkbox" checked={form.discontinued} onChange={(event) => update("discontinued", event.target.checked)} />Discontinued reference</label></div></div></section><section className="panel" style={{ marginTop: 16 }}><div className="eyebrow">Step 3</div><h2>Define the market scope</h2><p className="muted">This scope will determine which price listings count in later pipeline phases.</p><div className="form-grid"><div className="field"><label htmlFor="condition">Condition</label><select id="condition" name="condition" defaultValue="any"><option value="any">Any condition</option><option value="unworn">Unworn only</option><option value="pre_owned">Pre-owned only</option></select></div><div className="field"><label htmlFor="papers">Papers</label><select id="papers" name="papers" defaultValue="required"><option value="required">Required</option><option value="not_required">Not required</option></select></div><div className="field"><label htmlFor="yearMin">Production year, from</label><input id="yearMin" name="yearMin" type="number" min="1900" max="2100" /></div><div className="field"><label htmlFor="yearMax">Production year, to</label><input id="yearMax" name="yearMax" type="number" min="1900" max="2100" /></div><div className="field"><label htmlFor="box">Box</label><select id="box" name="box" defaultValue="not_required"><option value="not_required">Not required</option><option value="required">Required</option></select></div><div className="field"><label htmlFor="warranty">Warranty</label><select id="warranty" name="warranty" defaultValue="none_ok"><option value="factory_remaining">Factory warranty required</option><option value="third_party_ok">Factory or third-party accepted</option><option value="none_ok">No warranty requirement</option></select></div><div className="field wide"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" placeholder="Personal notes, dial details, or purchase context" /></div></div></section><div style={{ marginTop: 18 }}><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save watch"}</button>{error && <p className="error">{error}</p>}</div></>}</form>;
}
