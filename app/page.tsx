import Link from "next/link";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { getWatches } from "@/lib/watches";
import { AppShell } from "@/components/AppShell";
import { getLatestMarketSnapshots } from "@/lib/market";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  if (!(await hasSession())) redirect("/login");
  const watches = await getWatches("active");
  const snapshots = await getLatestMarketSnapshots(watches.map((watch) => watch.id));
  return <AppShell><section className="hero"><div><div className="eyebrow">Collection dashboard</div><h1>Your market view begins with a clean reference list.</h1><p className="muted">Curated seller listings are refreshed daily and measured against each watch’s saved scope.</p></div><Link className="button" href="/watches/new">Add a watch</Link></section>{watches.length ? <section className="card-grid">{watches.map((watch) => {
    const snapshot = snapshots.get(watch.id);
    return <Link className="card" href={`/watches/${watch.id}`} key={watch.id}><div><div className="eyebrow">{watch.model_name}</div><div className="watch-ref">{watch.reference_number}{watch.nickname ? ` · ${watch.nickname}` : ""}</div></div><div>{snapshot?.median_price_usd ? <><div className="price">${Number(snapshot.median_price_usd).toLocaleString()} median</div><div className="meta">{snapshot.matched_listing_count} scope-matched listing{snapshot.matched_listing_count === 1 ? "" : "s"} · {snapshot.observed_at.toLocaleDateString()}</div></> : <><div className="price">{watch.retail_price_usd ? `$${Number(watch.retail_price_usd).toLocaleString()} MSRP` : "MSRP pending"}</div><div className="meta">Research pending or no listings match this scope</div></>}</div></Link>;
  })}</section> : <section className="empty"><h2>Your collection is empty.</h2><p>Add a reference to establish its specs and precise market scope.</p><Link className="button" href="/watches/new">Add your first watch</Link></section>}</AppShell>;
}
