"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { WatchDraft } from "@/lib/catalog";
import { ReferenceLookup } from "@/components/ReferenceLookup";

type FormValues = Omit<WatchDraft, "source">;

const blank: FormValues = {
  referenceNumber: "",
  modelName: "",
  nickname: "",
  retailPriceUsd: null,
  discontinued: false,
  photoSourceUrl: null,
  specs: {},
};

export function NewWatchForm({ phase1bEnabled }: { phase1bEnabled: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<WatchDraft | null>(null);
  const [form, setForm] = useState<FormValues>(blank);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function useDraft(nextDraft: WatchDraft) {
    setError("");
    setDraft(nextDraft);
    const { source: _source, ...nextForm } = nextDraft;
    setForm(nextForm);
  }

  function update(key: keyof Omit<FormValues, "specs">, value: string | number | boolean | null) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSpec(key: keyof FormValues["specs"], value: string | number | null) {
    setForm((current) => ({ ...current, specs: { ...current.specs, [key]: value } }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.nickname.trim()) {
      setError("Give this watch a nickname before saving. It keeps your dashboard and research queries easy to identify.");
      return;
    }
    setError("");
    setSaving(true);
    const fields = new FormData(event.currentTarget);
    const numberOrNull = (key: string) => {
      const value = String(fields.get(key) ?? "").trim();
      return value ? Number(value) : null;
    };
    const payload = {
      ...form,
      modelName: form.modelName.trim(),
      nickname: form.nickname.trim(),
      retailPriceUsd: form.retailPriceUsd === null ? null : Number(form.retailPriceUsd),
      specs: { ...form.specs, caseSizeMm: form.specs.caseSizeMm ? Number(form.specs.caseSizeMm) : null },
      scope: {
        condition: String(fields.get("condition")),
        yearMin: phase1bEnabled ? numberOrNull("yearMin") : null,
        yearMax: phase1bEnabled ? numberOrNull("yearMax") : null,
        papers: String(fields.get("papers")),
        box: String(fields.get("box")),
        warranty: phase1bEnabled ? String(fields.get("warranty")) : "none_ok",
      },
      notes: String(fields.get("notes") ?? ""),
    };
    try {
      const response = await fetch("/api/watches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok || !data.id) {
        setError(data.error ?? "Could not save this watch.");
        return;
      }
      router.push(`/watches/${data.id}`);
      router.refresh();
    } catch {
      setError("Could not save this watch. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={submit}>
    <section className="panel">
      <div className="eyebrow">Step 1</div>
      <h2>Find the watch</h2>
      <p className="muted">Search the starter catalog by reference, model, or nickname, then confirm every returned field before saving.</p>
      <ReferenceLookup onSelect={useDraft} />
      {draft && <div className="confirmation">
        <h2>{form.modelName || "Reference not in the starter catalog"}</h2>
        <p>{form.modelName ? `Reference ${form.referenceNumber} · ${form.nickname || "nickname needed"}. Review the details below before saving.` : `We found no starter-catalog match for ${form.referenceNumber}. Complete and confirm the details manually.`}</p>
        <p className="source">Source: <a href={draft.source.url} target="_blank" rel="noreferrer">{draft.source.name}</a> — {draft.source.note}</p>
      </div>}
    </section>
    {draft && <>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Step 2</div>
        <h2>Confirm identity and specs</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="referenceNumber">Reference number</label><input id="referenceNumber" value={form.referenceNumber} onChange={(event) => update("referenceNumber", event.target.value)} required /></div>
          <div className="field"><label htmlFor="modelName">Model name</label><input id="modelName" value={form.modelName} onChange={(event) => update("modelName", event.target.value)} required /></div>
          <div className="field"><label htmlFor="nickname">Nickname <span aria-hidden="true">*</span></label><input id="nickname" value={form.nickname} onChange={(event) => update("nickname", event.target.value)} placeholder="e.g. Panda or Black Sub" minLength={2} maxLength={80} required aria-describedby="nickname-help" /><span id="nickname-help" className="field-hint">Required: this name appears on your dashboard and helps research find alias-based discussion.</span></div>
          <div className="field"><label htmlFor="retailPrice">Retail price (USD)</label><input id="retailPrice" type="number" min="0" value={form.retailPriceUsd ?? ""} onChange={(event) => update("retailPriceUsd", event.target.value ? Number(event.target.value) : null)} /></div>
          <div className="field"><label htmlFor="caseSize">Case size (mm)</label><input id="caseSize" type="number" min="1" value={form.specs.caseSizeMm ?? ""} onChange={(event) => updateSpec("caseSizeMm", event.target.value ? Number(event.target.value) : null)} /></div>
          <div className="field"><label htmlFor="dial">Dial</label><input id="dial" value={form.specs.dial ?? ""} onChange={(event) => updateSpec("dial", event.target.value)} /></div>
          <div className="field"><label htmlFor="bezel">Bezel</label><input id="bezel" value={form.specs.bezel ?? ""} onChange={(event) => updateSpec("bezel", event.target.value)} /></div>
          <div className="field"><label htmlFor="bracelet">Bracelet</label><input id="bracelet" value={form.specs.bracelet ?? ""} onChange={(event) => updateSpec("bracelet", event.target.value)} /></div>
          <div className="field"><label htmlFor="movement">Movement</label><input id="movement" value={form.specs.movement ?? ""} onChange={(event) => updateSpec("movement", event.target.value)} /></div>
          <div className="field"><label htmlFor="material">Material</label><input id="material" value={form.specs.material ?? ""} onChange={(event) => updateSpec("material", event.target.value)} /></div>
          <div className="field checkbox-field"><label><input type="checkbox" checked={form.discontinued} onChange={(event) => update("discontinued", event.target.checked)} />Discontinued reference</label></div>
        </div>
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Step 3</div>
        <h2>Define the market scope</h2>
        <p className="muted">This scope will determine which price listings count in later pipeline phases.</p>
        <div className="form-grid">
          <div className="field"><label htmlFor="condition">Condition</label><select id="condition" name="condition" defaultValue="any"><option value="any">Any condition</option><option value="unworn">Unworn only</option><option value="pre_owned">Pre-owned only</option></select></div>
          <div className="field"><label htmlFor="papers">Papers</label><select id="papers" name="papers" defaultValue="required"><option value="required">Required</option><option value="not_required">Not required</option></select></div>
          {phase1bEnabled && <><div className="field"><label htmlFor="yearMin">Production year, from</label><input id="yearMin" name="yearMin" type="number" min="1900" max="2100" /></div>
          <div className="field"><label htmlFor="yearMax">Production year, to</label><input id="yearMax" name="yearMax" type="number" min="1900" max="2100" /></div></>}
          <div className="field"><label htmlFor="box">Box</label><select id="box" name="box" defaultValue="not_required"><option value="not_required">Not required</option><option value="required">Required</option></select></div>
          {phase1bEnabled && <div className="field"><label htmlFor="warranty">Warranty</label><select id="warranty" name="warranty" defaultValue="none_ok"><option value="factory_remaining">Factory warranty required</option><option value="third_party_ok">Factory or third-party accepted</option><option value="none_ok">No warranty requirement</option></select></div>}
          <div className="field wide"><label htmlFor="notes">Notes</label><textarea id="notes" name="notes" placeholder="Personal notes, dial details, or purchase context" /></div>
        </div>
      </section>
      <div className="form-actions"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save watch"}</button>{error && <p className="error" role="alert">{error}</p>}</div>
    </>}
  </form>;
}
