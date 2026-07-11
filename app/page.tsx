import Link from "next/link";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { getWatches } from "@/lib/watches";
import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  if (!(await hasSession())) redirect("/login");
  const watches = await getWatches("active");
  return <AppShell><section className="hero"><div><div className="eyebrow">Collection dashboard</div><h1>Your market view begins with a clean reference list.</h1><p className="muted">Phase 0 is ready for watches, specs, scope, and future market research.</p></div><Link className="button" href="/watches/new">Add a watch</Link></section>{watches.length ? <section className="card-grid">{watches.map((watch) => <Link className="card" href={`/watches/${watch.id}`} key={watch.id}><div><div className="eyebrow">{watch.model_name}</div><div className="watch-ref">{watch.reference_number}{watch.nickname ? ` · ${watch.nickname}` : ""}</div></div><div><div className="price">{watch.retail_price_usd ? `$${Number(watch.retail_price_usd).toLocaleString()} MSRP` : "MSRP pending"}</div><div className="meta">Market signals arrive in Phase 1</div></div></Link>)}</section> : <section className="empty"><h2>Your collection is empty.</h2><p>Add a reference to establish its specs and precise market scope.</p><Link className="button" href="/watches/new">Add your first watch</Link></section>}</AppShell>;
}
