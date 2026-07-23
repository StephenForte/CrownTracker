import Link from "next/link";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { getWatches } from "@/lib/watches";
import { AppShell } from "@/components/AppShell";
import { getLatestMetrics, getSevenDayMovers } from "@/lib/market";
import { freshness } from "@/lib/phase1b";
import { getBudgetStatus } from "@/lib/alerts";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
const money = (value: string | null | undefined) => value ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "Gathering";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ sort?: string; availability?: string }> }) {
  if (!(await hasSession())) redirect("/login");
  const filters = await searchParams;
  const watches = await getWatches("active"), ids = watches.map((watch) => watch.id), [metrics, movers, budget] = await Promise.all([getLatestMetrics(ids), getSevenDayMovers(ids), getBudgetStatus(db)]);
  const filtered = watches.filter((watch) => !filters.availability || filters.availability === "all" || metrics.get(watch.id)?.get("availability")?.label?.toLowerCase() === filters.availability);
  const sorted = [...filtered].sort((left, right) => {
    if (filters.sort === "mover") return Math.abs(movers.get(right.id) ?? 0) - Math.abs(movers.get(left.id) ?? 0);
    if (filters.sort === "availability") return (metrics.get(right.id)?.get("availability")?.value ? Number(metrics.get(right.id)?.get("availability")?.value) : -1) - (metrics.get(left.id)?.get("availability")?.value ? Number(metrics.get(left.id)?.get("availability")?.value) : -1);
    return right.created_at.getTime() - left.created_at.getTime();
  });
  return <AppShell><section className="hero"><div><div className="eyebrow">Collection dashboard</div><h1>Know the market before you make a move.</h1><p className="muted">Asking-price estimates are scope-matched, source-linked, and visibly graded for confidence and freshness.</p></div><Link className="button" href="/watches/new">Add a watch</Link></section>{budget.state === "warning" || budget.state === "paused" ? <p className={`budget-banner ${budget.state}`}>Tavily usage: {budget.used} of {budget.cap} credits ({Math.round((budget.percentage ?? 0) * 100)}%). {budget.state === "paused" ? "Capped searches are paused until the next monthly budget window." : "Review usage before the cap is reached."}</p> : null}{watches.length ? <><form className="dashboard-controls" action="/"><label>Sort <select name="sort" defaultValue={filters.sort ?? "newest"}><option value="newest">Recently added</option><option value="mover">Biggest 7-day mover</option><option value="availability">Availability</option></select></label><label>Availability <select name="availability" defaultValue={filters.availability ?? "all"}><option value="all">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><button type="submit" className="secondary">Apply</button></form><section className="card-grid">{sorted.map((watch) => {
    const values = metrics.get(watch.id), grey = values?.get("grey_avg"), resell = values?.get("resell_avg"), availability = values?.get("availability");
    const age = freshness(grey?.computed_at ?? resell?.computed_at);
    const sentiment = values?.get("sentiment"), waitlist = values?.get("waitlist"), mover = movers.get(watch.id);
    return <article className="card market-card" key={watch.id}><Link className="market-card-main" href={`/watches/${watch.id}`}><div className="card-heading"><div><div className="eyebrow">{watch.reference_number}</div><div className="watch-ref">{watch.nickname}</div><p className="card-model">{watch.model_name}</p></div><span className={`freshness ${age.state}`}>{age.label}</span></div>{watch.photo_mime && <img className="market-card-photo" src={`/api/watches/${watch.id}/photo`} alt={`${watch.nickname} watch`} />}<div className="metric-pair"><div><span>Avg asking (grey)</span><strong>{money(grey?.value)}</strong><small>{grey ? `n=${grey.n}${grey.n_uncertain ? ` + ${grey.n_uncertain} uncertain` : ""} · ${grey.confidence}` : "Run research to start"}</small></div><div><span>Avg asking (resell)</span><strong>{money(resell?.value)}</strong><small>{resell ? `n=${resell.n}${resell.n_uncertain ? ` + ${resell.n_uncertain} uncertain` : ""} · ${resell.confidence}` : "Run research to start"}</small></div></div><div className="card-footer"><span>Availability: <b>{availability?.label ?? "Gathering"}</b>{mover !== undefined ? ` · ${(mover * 100).toFixed(1)}% 7d` : ""}</span><span>{sentiment?.label ?? "Sentiment gathering"} · {waitlist?.label ?? "Waitlist gathering"}</span></div></Link>{watch.tracked_watch_url && <a className="tracked-watch-card-link" href={watch.tracked_watch_url} target="_blank" rel="noreferrer">Open tracked watch ↗</a>}</article>;
  })}</section></> : <section className="empty"><h2>Your collection is empty.</h2><p>Add a reference to establish its specs and market scope.</p><Link className="button" href="/watches/new">Add your first watch</Link></section>}</AppShell>;
}
