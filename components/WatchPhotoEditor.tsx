"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const accepted = "image/avif,image/gif,image/jpeg,image/png,image/webp";

export function WatchPhotoEditor({ id, nickname }: { id: string; nickname: string }) {
  const router = useRouter();
  const [hasPhoto, setHasPhoto] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { fetch(`/api/watches/${id}/photo`, { method: "HEAD" }).then((response) => setHasPhoto(response.ok)).catch(() => setHasPhoto(false)); }, [id]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    setFile(event.target.files?.[0] ?? null);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError("Choose an image before uploading."); return; }
    setSaving(true); setError("");
    const form = new FormData(); form.append("photo", file);
    try {
      const response = await fetch(`/api/watches/${id}/photo`, { method: "PUT", body: form });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setError(data.error ?? "Could not upload the watch photo."); return; }
      setFile(null); setHasPhoto(true); router.refresh();
    } catch { setError("Could not upload the watch photo. Please try again."); }
    finally { setSaving(false); }
  }

  async function remove() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/watches/${id}/photo`, { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setError(data.error ?? "Could not remove the watch photo."); return; }
      setFile(null); setHasPhoto(false); router.refresh();
    } catch { setError("Could not remove the watch photo. Please try again."); }
    finally { setSaving(false); }
  }

  return <form className="watch-photo-editor" onSubmit={upload}>
    <div><div className="eyebrow">Watch photo</div><p className="field-hint">Optional personal image. AVIF, JPEG, PNG, WebP, or GIF — up to 5 MB.</p></div>
    {hasPhoto && <img className="watch-photo-preview" src={`/api/watches/${id}/photo`} alt={`Photo of ${nickname}`} />}
    <input type="file" accept={accepted} onChange={chooseFile} />
    <div className="inline-actions"><button type="submit" disabled={saving}>{saving ? "Saving…" : hasPhoto ? "Replace photo" : "Upload photo"}</button>{hasPhoto && <button className="secondary" type="button" onClick={remove} disabled={saving}>Remove photo</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
