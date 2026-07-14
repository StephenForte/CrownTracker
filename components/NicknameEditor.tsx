"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function NicknameEditor({ id, nickname }: { id: string; nickname: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(nickname);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const response = await fetch(`/api/watches/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname: value }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not update the nickname.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not update the nickname. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return <button className="secondary" type="button" onClick={() => setOpen(true)}>Edit nickname</button>;
  return <form className="inline-editor" onSubmit={submit}>
    <div className="field"><label htmlFor="edit-nickname">Nickname</label><input id="edit-nickname" value={value} onChange={(event) => setValue(event.target.value)} minLength={2} maxLength={80} required autoFocus /></div>
    <div className="inline-actions"><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save nickname"}</button><button className="secondary" type="button" onClick={() => { setValue(nickname); setError(""); setOpen(false); }}>Cancel</button></div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
