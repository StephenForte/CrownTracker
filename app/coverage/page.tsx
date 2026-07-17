import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getSourceCoverageReport } from "@/lib/market";

export const dynamic = "force-dynamic";

function observedAt(value: Date | null) { return value ? value.toLocaleDateString() : "No retained observation"; }

export default async function CoveragePage() {
  if (!(await hasSession())) redirect("/login");
  const sources = await getSourceCoverageReport();
  return <AppShell><section className="detail-header"><div><div className="eyebrow">Phase 3B</div><h1>Source coverage</h1><p className="muted">Observed listing and evidence coverage from the last 30 days. This does not infer that an unobserved source is blocked or unavailable.</p></div></section><section className="panel coverage-table"><div className="coverage-row coverage-head"><span>Source</span><span>Listings</span><span>Watches</span><span>Latest observation</span><span>Link check</span></div>{sources.map((source) => <div className="coverage-row" key={source.domain}><div><strong>{source.domain}</strong><small>{source.curated ? "Curated market source" : "Evidence-only source"}</small></div><span>{source.active_listings}</span><span>{source.watches_observed}</span><span>{observedAt(source.last_seen_at)}</span><span>{source.last_link_status ? `${source.last_link_status.replaceAll("_", " ")} · ${observedAt(source.last_link_checked_at)}` : source.evidence_items ? "Not yet checked" : "No current evidence"}</span></div>)}</section><p className="market-note">The monthly link-health run checks current metric evidence only, obeying each site’s robots policy. A robots-blocked URL is shown as unverified, not offline.</p></AppShell>;
}
