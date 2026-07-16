import Link from "next/link";
import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { getWatches } from "@/lib/watches";
import { AppShell } from "@/components/AppShell";
import { WatchStatusButton } from "@/components/WatchStatusButton";

export const dynamic = "force-dynamic";

export default async function ArchivedWatchesPage() {
  if (!(await hasSession())) redirect("/login");
  const watches = await getWatches("archived");
  return <AppShell>
    <section className="hero">
      <div>
        <div className="eyebrow">Archived watches</div>
        <h1>Watches set aside from active research.</h1>
        <p className="muted">History stays intact. Restore a watch to put it back on the dashboard and resume refreshes.</p>
      </div>
      <Link className="button secondary" href="/">Back to dashboard</Link>
    </section>
    {watches.length ? (
      <section className="panel archived-list">
        {watches.map((watch) => (
          <div className="archived-row" key={watch.id}>
            <Link className="archived-row-link" href={`/watches/${watch.id}`}>
              <div className="eyebrow">{watch.reference_number}</div>
              <div className="watch-ref">{watch.nickname}</div>
              <p className="card-model">{watch.model_name}</p>
            </Link>
            <WatchStatusButton id={watch.id} status="archived" />
          </div>
        ))}
      </section>
    ) : (
      <section className="empty">
        <h2>No archived watches.</h2>
        <p>Archive a watch from its detail page when you want to pause research without losing history.</p>
        <Link className="button secondary" href="/">Back to dashboard</Link>
      </section>
    )}
  </AppShell>;
}
