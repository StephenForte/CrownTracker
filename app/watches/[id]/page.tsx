import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { getWatch } from "@/lib/watches";
import { AppShell } from "@/components/AppShell";
import { WatchStatusButton } from "@/components/WatchStatusButton";
import { ScopeEditor } from "@/components/ScopeEditor";

export const dynamic = "force-dynamic";

export default async function WatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) redirect("/login");
  const watch = await getWatch((await params).id); if (!watch) notFound();
  const specs = Object.entries(watch.specs).filter(([, value]) => value);
  return <AppShell><section className="detail-header"><div><div className="eyebrow">{watch.status} reference</div><h1>{watch.reference_number}{watch.nickname ? ` · ${watch.nickname}` : ""}</h1><p className="muted">{watch.model_name}</p></div><WatchStatusButton id={watch.id} status={watch.status} /></section><section className="card-grid"><section className="panel"><div className="eyebrow">Retail</div><h2>{watch.retail_price_usd ? `$${Number(watch.retail_price_usd).toLocaleString()}` : "Pending confirmation"}</h2><p className="muted">{watch.discontinued ? "Last known MSRP — discontinued" : "Confirmed during Phase 0 lookup"}</p></section><section className="panel"><div className="eyebrow">Market data</div><h2>Gathering starts in Phase 1</h2><p className="muted">Prices, availability, provenance, and sentiment will appear here after the pipeline is implemented.</p></section></section><section className="panel" style={{ marginTop: 16 }}><div className="eyebrow">Technical specs</div><dl className="kv">{specs.length ? specs.map(([key, value]) => <><dt key={`${key}-term`}>{key.replace(/([A-Z])/g, " $1")}</dt><dd key={`${key}-value`}>{String(value)}</dd></>) : <p className="muted">No specs have been confirmed yet.</p>}</dl></section><section className="panel" style={{ marginTop: 16 }}><div className="eyebrow">Tracked market scope</div><div className="scope-summary"><span className="chip">{watch.scope.condition.replace("_", " ")}</span><span className="chip">papers {watch.scope.papers.replace("_", " ")}</span><span className="chip">box {watch.scope.box.replace("_", " ")}</span><span className="chip">{watch.scope.warranty.replaceAll("_", " ")}</span>{watch.scope.yearMin && <span className="chip">from {watch.scope.yearMin}</span>}{watch.scope.yearMax && <span className="chip">to {watch.scope.yearMax}</span>}</div><ScopeEditor id={watch.id} scope={watch.scope} />{watch.notes && <p className="muted">{watch.notes}</p>}</section><p style={{ marginTop: 22 }}><Link href="/">← Back to dashboard</Link></p></AppShell>;
}
