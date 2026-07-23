"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { WatchPhotoEditor } from "@/components/WatchPhotoEditor";

export function TrackedWatchUrlEditor({ id, nickname, trackedWatchUrl }: { id: string; nickname: string; trackedWatchUrl: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(trackedWatchUrl ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackedWatchUrl: value }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not update the tracked watch URL.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not update the tracked watch URL. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trackedWatchUrl: null }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not remove the tracked watch URL.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not remove the tracked watch URL. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <div className="personal-watch-editors"><div className="inline-actions">{trackedWatchUrl && <a className="button secondary" href={trackedWatchUrl} target="_blank" rel="noreferrer">Open tracked watch ↗</a>}<button className="secondary" type="button" onClick={() => setOpen(true)}>{trackedWatchUrl ? "Edit link" : "Add link"}</button></div><WatchPhotoEditor id={id} nickname={nickname} /></div>;
  return <form className="inline-editor" onSubmit={submit}>
    <div className="field"><label htmlFor="tracked-watch-url">Watch URL</label><input id="tracked-watch-url" type="url" value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://…" maxLength={2000} autoFocus /><span className="field-hint">Optional. Save a direct link to the specific watch you are tracking; it is not used by market research.</span></div>
    <div className="inline-actions"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save link"}</button><button className="secondary" type="button" onClick={() => { setValue(trackedWatchUrl ?? ""); setError(""); setOpen(false); }}>Cancel</button></div>
    {trackedWatchUrl && <button className="link-button" type="button" onClick={remove} disabled={saving}>Remove link</button>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
