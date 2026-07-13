import Link from "next/link";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { getWatches } from "@/lib/watches";
import { AppShell } from "@/components/AppShell";
import { getLatestMetrics } from "@/lib/market";
import { freshness } from "@/lib/phase1b";

export const dynamic = "force-dynamic";
const money = (value: string | null | undefined) => value ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "Gathering";

export default async function Dashboard() {
  if (!(await hasSession())) redirect("/login");
  const watches = await getWatches("active"), metrics = await getLatestMetrics(watches.map((watch) => watch.id));
  return <AppShell><section className="hero"><div><div className="eyebrow">Collection dashboard</div><h1>Know the market before you make a move.</h1><p className="muted">Asking-price estimates are scope-matched, source-linked, and visibly graded for confidence and freshness.</p></div><Link className="button" href="/watches/new">Add a watch</Link></section>{watches.length ? <section className="card-grid">{watches.map((watch) => {
    const values = metrics.get(watch.id), grey = values?.get("grey_avg"), resell = values?.get("resell_avg"), availability = values?.get("availability");
    const age = freshness(grey?.computed_at ?? resell?.computed_at);
    return <Link className="card market-card" href={`/watches/${watch.id}`} key={watch.id}><div className="card-heading"><div><div className="eyebrow">{watch.model_name}</div><div className="watch-ref">{watch.reference_number}{watch.nickname ? ` · ${watch.nickname}` : ""}</div></div><span className={`freshness ${age.state}`}>{age.label}</span></div><div className="metric-pair"><div><span>Avg asking (grey)</span><strong>{money(grey?.value)}</strong><small>{grey ? `n=${grey.n}${grey.n_uncertain ? ` + ${grey.n_uncertain} uncertain` : ""} · ${grey.confidence}` : "Run research to start"}</small></div><div><span>Avg asking (resell)</span><strong>{money(resell?.value)}</strong><small>{resell ? `n=${resell.n}${resell.n_uncertain ? ` + ${resell.n_uncertain} uncertain` : ""} · ${resell.confidence}` : "Run research to start"}</small></div></div><div className="card-footer"><span>Availability: <b>{availability?.label ?? "Gathering"}</b></span><span>{watch.retail_price_usd ? `${money(watch.retail_price_usd)} MSRP` : "MSRP pending"}</span></div></Link>;
  })}</section> : <section className="empty"><h2>Your collection is empty.</h2><p>Add a reference to establish its specs and market scope.</p><Link className="button" href="/watches/new">Add your first watch</Link></section>}</AppShell>;
}
