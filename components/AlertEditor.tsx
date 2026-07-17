"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import type { WatchAlert } from "@/lib/alerts";

type FormValues = { greyAbove: string; greyBelow: string; resellAbove: string; resellBelow: string };

function values(alert: WatchAlert | null): FormValues {
  return { greyAbove: alert?.grey_above ?? "", greyBelow: alert?.grey_below ?? "", resellAbove: alert?.resell_above ?? "", resellBelow: alert?.resell_below ?? "" };
}

export function AlertEditor({ id, alert, deliveryEnabled }: { id: string; alert: WatchAlert | null; deliveryEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [form, setForm] = useState(values(alert)), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const update = (field: keyof FormValues, value: string) => setForm((current) => ({ ...current, [field]: value }));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() ? Number(value) : null]));
    try {
      const response = await fetch(`/api/watches/${id}/alerts`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setError(data.error ?? "Could not save alerts."); return; }
      setOpen(false); router.refresh();
    } catch { setError("Could not save alerts. Please try again."); } finally { setSaving(false); }
  }
  if (!open) return <button className="secondary" type="button" onClick={() => setOpen(true)}>{alert ? "Edit thresholds" : "Set thresholds"}</button>;
  return <form className="inline-editor" onSubmit={submit}><p className="field-hint">Leave a field blank to disable that direction. Alerts send only when a price crosses into the configured condition.</p><div className="form-grid"><Field label="Grey above" value={form.greyAbove} onChange={(value) => update("greyAbove", value)} /><Field label="Grey below" value={form.greyBelow} onChange={(value) => update("greyBelow", value)} /><Field label="Resell above" value={form.resellAbove} onChange={(value) => update("resellAbove", value)} /><Field label="Resell below" value={form.resellBelow} onChange={(value) => update("resellBelow", value)} /></div>{!deliveryEnabled && <p className="field-hint">Thresholds are saved now. Add the Resend variables described in the deployment guide before emails can be sent.</p>}<div className="inline-actions"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save thresholds"}</button><button className="secondary" type="button" onClick={() => { setForm(values(alert)); setError(""); setOpen(false); }}>Cancel</button></div>{error && <p className="error" role="alert">{error}</p>}</form>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="field"><label>{label} (USD)</label><input type="number" min="1" max="1000000" step="1" inputMode="decimal" placeholder="e.g. 18000" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
