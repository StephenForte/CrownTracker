"use client";

import { useEffect, useState } from "react";
import type { CatalogSuggestion, WatchDraft } from "@/lib/catalog";
import type { WatchBaseCandidate } from "@/lib/watchbase";

type Props = { onSelect: (draft: WatchDraft) => void };

export function ReferenceLookup({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CatalogSuggestion[]>([]);
  const [error, setError] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [archiveCandidates, setArchiveCandidates] = useState<WatchBaseCandidate[]>([]);
  const hasQuery = Boolean(query.trim());

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
      setArchiveCandidates([]);
      onSelect(data);
    } catch {
      setError("Could not look up that reference. Please try again.");
    } finally {
      setLookingUp(false);
    }
  }

  async function searchArchive() {
    setError("");
    setLookingUp(true);
    try {
      const response = await fetch(`/api/watchbase-lookup?reference=${encodeURIComponent(query)}`);
      const data = await response.json() as WatchBaseCandidate[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) {
        setArchiveCandidates([]);
        setError((data as { error?: string }).error ?? "Could not search the WatchBase archive.");
        return;
      }
      setMatches([]);
      setArchiveCandidates(data);
      if (!data.length) setError("WatchBase did not return a Rolex reference for that search.");
    } catch {
      setArchiveCandidates([]);
      setError("Could not search the WatchBase archive. Please try again.");
    } finally {
      setLookingUp(false);
    }
  }

  function chooseArchive(candidate: WatchBaseCandidate) {
    setError("");
    setQuery(candidate.referenceNumber);
    setArchiveCandidates([]);
    onSelect(candidate);
  }

  return <div className="reference-lookup">
    <label htmlFor="reference-search">Find a reference</label>
    <div className="lookup">
      <input id="reference-search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (query.trim()) void choose(query); } }} placeholder="Search ref, model, or nickname" autoComplete="off" />
      <button type="button" onClick={() => void choose(query)} disabled={!query.trim() || lookingUp}>Use local/manual</button>
      <button className="secondary" type="button" onClick={() => void searchArchive()} disabled={!query.trim() || lookingUp}>{lookingUp ? "Looking up…" : "Look up archive"}</button>
    </div>
    <p className="field-hint">Try “Pepsi,” “Sprite,” “Explorer 2,” “Sub,” or a reference number. Archive lookup runs only when you press the button and returns up to eight Rolex candidates to confirm.</p>
    {hasQuery && <p className="field-hint"><a href={`https://watchbase.com/search#q=${encodeURIComponent(query.trim())}`} target="_blank" rel="noreferrer">Search WatchBase’s public archive for “{query.trim()}” ↗</a></p>}
    {matches.length > 0 && <div className="catalog-results" role="listbox" aria-label="Matching references">
      {matches.map((match) => <button type="button" className="catalog-result" key={match.referenceNumber} onClick={() => void choose(match.referenceNumber)}>
        <strong>{match.nickname}</strong><span>{match.referenceNumber} · {match.modelName}</span>
      </button>)}
    </div>}
    {archiveCandidates.length > 0 && <div className="catalog-results" role="listbox" aria-label="WatchBase archive matches">
      {archiveCandidates.map((candidate) => <button type="button" className="catalog-result" key={candidate.id} onClick={() => chooseArchive(candidate)}>
        <strong>{candidate.nickname}</strong><span>{candidate.referenceNumber} · {candidate.modelName}</span>
      </button>)}
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
