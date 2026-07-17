"use client";

import { useEffect, useState } from "react";
import type { CatalogSuggestion, WatchDraft } from "@/lib/catalog";

type Props = { onSelect: (draft: WatchDraft) => void };

export function ReferenceLookup({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CatalogSuggestion[]>([]);
  const [error, setError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (response.ok) setMatches(await response.json() as CatalogSuggestion[]);
      } catch (cause) {
        if ((cause as Error).name !== "AbortError") setMatches([]);
      }
    }, 120);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  async function choose(reference: string) {
    setError("");
    setLookingUp(true);
    try {
      const response = await fetch(`/api/spec-lookup?reference=${encodeURIComponent(reference)}`);
      const data = await response.json() as WatchDraft & { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not look up that reference.");
        return;
      }
      setQuery(data.referenceNumber);
      setMatches([]);
      onSelect(data);
    } catch {
      setError("Could not look up that reference. Please try again.");
    } finally {
      setLookingUp(false);
    }
  }

  return <div className="reference-lookup">
    <label htmlFor="reference-search">Find a reference</label>
    <div className="lookup">
      <input id="reference-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (query.trim()) void choose(query); } }} placeholder="Search ref, model, or nickname" autoComplete="off" />
      <button type="button" onClick={() => void choose(query)} disabled={!query.trim() || lookingUp}>{lookingUp ? "Looking up…" : "Use reference"}</button>
    </div>
    <p className="field-hint">Try “Pepsi,” “Sprite,” “Explorer 2,” “Sub,” or a reference number. The local index recognizes common aliases; you can also enter an unlisted reference and confirm it manually.</p>
    {matches.length > 0 && <div className="catalog-results" role="listbox" aria-label="Matching references">
      {matches.map((match) => <button type="button" className="catalog-result" key={match.referenceNumber} onClick={() => void choose(match.referenceNumber)}>
        <strong>{match.nickname}</strong><span>{match.referenceNumber} · {match.modelName}</span>
      </button>)}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
