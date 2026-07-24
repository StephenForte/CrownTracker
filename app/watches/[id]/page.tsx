import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { getWatch } from "@/lib/watches";
import { AppShell } from "@/components/AppShell";
import { WatchStatusButton } from "@/components/WatchStatusButton";
import { ScopeEditor } from "@/components/ScopeEditor";
import { RefreshButton } from "@/components/RefreshButton";
import { NicknameEditor } from "@/components/NicknameEditor";
import { TrackedWatchUrlEditor } from "@/components/TrackedWatchUrlEditor";
import { getMarketDetails, type Evidence, type MarketListing, type MetricSnapshot } from "@/lib/market";
import { freshness, isPhase1bEnabled, trustBucket } from "@/lib/phase1b";
import { emailAlertsEnabled, getWatchAlert } from "@/lib/alerts";
import { db } from "@/lib/db";
import { AlertEditor } from "@/components/AlertEditor";

export const dynamic = "force-dynamic";
const money = (value: string | null | undefined) => value ? `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "Not enough market data";

function LinkHealth({ evidence }: { evidence: Evidence }) {
  if (!evidence.link_status || evidence.link_status === "reachable") return null;
  if (evidence.link_status === "blocked_by_robots") return <small className="link-health">Link health was not checked because the source&apos;s robots policy blocks it.</small>;
  if (evidence.link_status === "invalid") return <small className="link-health warning">This source URL could not be checked safely; the preserved quote remains available.</small>;
  return <small className="link-health warning">Source link was unavailable when last checked{evidence.link_checked_at ? ` on ${evidence.link_checked_at.toLocaleDateString()}` : ""}; the preserved quote remains available.</small>;
}

function EvidenceItems({ evidence }: { evidence: Evidence[] }) {
  return <ul>{evidence.map((item) => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.domain}</a><span> — {item.quote}</span><LinkHealth evidence={item} /></li>)}</ul>;
}

function MetricPanel({ title, snapshot, ma, evidence }: { title: string; snapshot?: MetricSnapshot; ma?: { value: string | null; weeks: number; hasFullYear: boolean; backfillCount: number }; evidence: Evidence[] }) {
  const age = freshness(snapshot?.computed_at);
  return <section className={`panel metric-panel ${age.state}`}><div className="panel-row"><div className="eyebrow">{title}</div>{snapshot && <span className={`freshness ${age.state}`}>{age.label}</span>}</div><h2>{money(snapshot?.value)}</h2>{snapshot ? <><p className="muted">{snapshot.n} in scope{snapshot.n_uncertain ? ` + ${snapshot.n_uncertain} uncertain` : ""} · <b>{snapshot.confidence}</b> confidence</p><p className="metric-subline">{ma?.value ? `${ma.hasFullYear ? "52" : ma.weeks}-wk avg${ma.hasFullYear ? "" : " (partial)"}: ${money(ma.value)}` : "Moving average starts with the first verified observation."}</p><details className="provenance"><summary>Why this number?</summary><p>Median after IQR outlier removal ({snapshot.outliers_dropped} dropped). Confidence: sample {Math.round(snapshot.conf_sample * 100)}%, source diversity {Math.round(snapshot.conf_diversity * 100)}%, agreement {Math.round(snapshot.conf_agreement * 100)}%.</p>{evidence.length ? <EvidenceItems evidence={evidence} /> : <p>No retained evidence is available for this run.</p>}</details></> : <p className="muted">Refresh this watch to collect grounded listing rows.</p>}</section>;
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return evidence.length ? <details className="provenance"><summary>View evidence</summary><EvidenceItems evidence={evidence} /></details> : <p className="muted">No grounded evidence is available for this run.</p>;
}

function ModeledPanel({ title, snapshot, evidence, hasCompletedChatterRun = false }: { title: string; snapshot?: MetricSnapshot; evidence: Evidence[]; hasCompletedChatterRun?: boolean }) {
  const emptyMessage = title === "Market sentiment" && hasCompletedChatterRun ? "The most recent chatter scan did not find enough distinct grounded sentiment evidence." : "The next chatter scan will collect grounded community reports.";
  return <section className="panel metric-panel"><div className="panel-row"><div className="eyebrow">{title}</div>{snapshot && <span className={`freshness ${freshness(snapshot.computed_at).state}`}>{freshness(snapshot.computed_at).label}</span>}</div><h2>{snapshot?.label ?? "Gathering"}</h2>{snapshot ? <><p className="muted">{snapshot.confidence === "insufficient" ? "No modeled estimate yet." : `${snapshot.n} source reports · ${snapshot.confidence} confidence`}</p>{title === "Est. waitlist" && <p className="metric-subline">Modeled estimate — anecdotes must state both a wait and a date.</p>}{title === "Market sentiment" && <p className="metric-subline">Community feeling is separate from price movement.</p>}<EvidenceList evidence={evidence} /></> : <p className="muted">{emptyMessage}</p>}</section>;
}

function WhereToBuyPanel({ listings }: { listings: MarketListing[] }) {
  if (!listings.length) return <section className="panel"><div className="eyebrow">Where to buy</div><p className="muted">No current listing rows meet or partially meet this scope. This is a normal result for a narrow scope.</p></section>;
  const sellers = new Set(listings.map((listing) => listing.seller_name ?? listing.seller_domain ?? "Unknown seller"));
  const trusted = listings.filter((listing) => listing.curated || (listing.trust_score ?? 0) >= 80).length;
  return <section className="panel"><div className="eyebrow">Where to buy</div><p className="muted">{listings.length} current listing{listings.length === 1 ? "" : "s"} from {sellers.size} seller{sellers.size === 1 ? "" : "s"}{trusted ? ` · ${trusted} curated or trusted` : ""}.</p><details className="where-to-buy-details"><summary>Show listings, sellers, and trust details</summary><div className="listing-table">{listings.map((listing) => <a key={listing.id} href={listing.detail_url ?? listing.source_url} target="_blank" rel="noreferrer"><div><strong>{listing.seller_name ?? listing.seller_domain ?? "Seller"} <span className={`trust ${trustBucket(listing.trust_score).toLowerCase().replace(" ", "-")}`}>{trustBucket(listing.trust_score)}{listing.curated ? " · curated" : " · inferred"}</span></strong><span>{listing.title}</span><small>{listing.scope_match_class === "uncertain" ? `Scope uncertain: ${listing.scope_reason}` : "Matches your saved scope"}</small>{listing.trust_rationale && <small>Trust basis: {listing.trust_rationale}</small>}</div><div><strong>{money(listing.price_usd)}</strong><span>{listing.price_original && listing.currency !== "USD" ? `${Number(listing.price_original).toLocaleString()} ${listing.currency}` : "USD asking"}</span>{listing.anomaly_flags.includes("price_too_low") && <small className="warning">⚠ Well below market</small>}</div></a>)}</div><p className="market-note">Trust scores are advisory. Curated sellers are seed-reviewed; inferred scores are grounded in monthly public-source research. Verify payment protections independently.</p></details></section>;
}

export default async function WatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) redirect("/login");
  const watch = await getWatch((await params).id); if (!watch) notFound();
  const [market, alert] = await Promise.all([getMarketDetails(watch.id), getWatchAlert(db, watch.id)]);
  const grey = market.latest.get("grey_avg"), resell = market.latest.get("resell_avg"), availability = market.latest.get("availability"), waitlist = market.latest.get("waitlist"), sentiment = market.latest.get("sentiment");
  const specs = Object.entries(watch.specs).filter(([, value]) => value);
  const greyEvidence = grey ? market.evidenceBySnapshot.get(grey.id) ?? [] : [];
  const resellEvidence = resell ? market.evidenceBySnapshot.get(resell.id) ?? [] : [];
  const waitlistEvidence = waitlist ? market.evidenceBySnapshot.get(waitlist.id) ?? [] : [];
  const sentimentEvidence = sentiment ? market.evidenceBySnapshot.get(sentiment.id) ?? [] : [];
  const phase1bEnabled = isPhase1bEnabled();
  const priceHistory = market.metrics.filter((metric) => metric.metric === "grey_avg" || metric.metric === "resell_avg");

  return (
    <AppShell>
      <section className="detail-header">
        <div>
          <Link className="detail-crumb" href="/">← Collection</Link>
          <div className="detail-title-row">
            <div>
              <div className="eyebrow">
                <span className={`status-pill ${watch.status}`}>{watch.status}</span>
                <span>Reference · {watch.reference_number}</span>
              </div>
              <h1>{watch.nickname}</h1>
              <p className="muted detail-model">{watch.model_name}</p>
            </div>
          </div>
        </div>
        <div className="detail-actions">
          {watch.status === "active" && <RefreshButton id={watch.id} />}
          <WatchStatusButton id={watch.id} status={watch.status} />
        </div>
      </section>

      <nav className="detail-subnav" aria-label="Watch sections">
        <a href="#market">Market</a>
        <a href="#buy">Where to buy</a>
        <a href="#research">Research</a>
        <a href="#specs">Specs</a>
        <a href="#manage">Manage</a>
      </nav>

      <div className="detail-stack">
        <section id="market" className="detail-section">
          <div className="section-heading">
            <div className="eyebrow">Market</div>
            <h2 className="section-title">Price & availability</h2>
          </div>
          <section className="card-grid">
            <section className="panel">
              <div className="eyebrow">Retail</div>
              <h2>{watch.retail_price_usd ? money(watch.retail_price_usd) : "Pending confirmation"}</h2>
              <p className="muted">{watch.discontinued ? "Last known MSRP — discontinued" : "Confirmed during initial lookup"}</p>
            </section>
            <section className="panel">
              <div className="eyebrow">Availability</div>
              <h2>{availability?.label ?? "Gathering"}</h2>
              <p className="muted">{availability ? `${availability.n} currently in-scope listings · ${freshness(availability.computed_at).label}` : "Calculated after the first price scan."}</p>
            </section>
          </section>
          <section className="card-grid">
            <MetricPanel title="Avg asking (grey)" snapshot={grey} ma={market.movingAverages.get("grey_avg")} evidence={greyEvidence} />
            <MetricPanel title="Avg asking (resell)" snapshot={resell} ma={market.movingAverages.get("resell_avg")} evidence={resellEvidence} />
          </section>
          <section className="card-grid">
            <ModeledPanel title="Est. waitlist" snapshot={waitlist} evidence={waitlistEvidence} />
            <ModeledPanel title="Market sentiment" snapshot={sentiment} evidence={sentimentEvidence} hasCompletedChatterRun={market.hasCompletedChatterRun} />
          </section>
        </section>

        <section id="buy" className="detail-section">
          <div className="section-heading">
            <div className="eyebrow">Listings</div>
            <h2 className="section-title">Where to buy</h2>
          </div>
          <WhereToBuyPanel listings={market.listings} />
        </section>

        <section id="research" className="detail-section">
          <div className="section-heading">
            <div className="eyebrow">Context</div>
            <h2 className="section-title">Research & history</h2>
          </div>
          <section className="panel">
            <div className="eyebrow">Reference news</div>
            {market.news.length ? (
              <div className="news-list">
                {market.news.map((item) => (
                  <article key={item.id}>
                    <a href={item.source_url} target="_blank" rel="noreferrer"><strong>{item.title}</strong></a>
                    <p>{item.summary}</p>
                    <small>{item.domain} · {item.retrieved_at.toLocaleDateString()}</small>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No reference-specific news in the last 30 days.</p>
            )}
          </section>
          {market.anecdotes.length > 0 && (
            <section className="panel">
              <div className="eyebrow">Waitlist reports</div>
              <div className="history-list">
                {market.anecdotes.slice(0, 8).map((item) => (
                  <div key={item.id}>
                    <span>{item.reported_at?.toLocaleDateString() ?? "Undated"}</span>
                    <strong>{item.wait_months ? `≈ ${item.wait_months} months` : "Wait stated"}</strong>
                    <a href={item.source_url} target="_blank" rel="noreferrer">{item.domain}</a>
                  </div>
                ))}
              </div>
            </section>
          )}
          {priceHistory.length > 2 && (
            <section className="panel">
              <div className="eyebrow">Recent market history</div>
              <div className="history-list">
                {priceHistory.slice(0, 12).map((metric) => (
                  <div key={metric.id}>
                    <span>{metric.computed_at.toLocaleDateString()}</span>
                    <strong>{metric.metric === "grey_avg" ? "Grey" : "Resell"}: {money(metric.value)}</strong>
                    <span>{metric.n} listings · {metric.provenance}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>

        <section id="specs" className="detail-section">
          <div className="section-heading">
            <div className="eyebrow">Reference</div>
            <h2 className="section-title">Technical specs</h2>
          </div>
          <section className="panel">
            <dl className="kv">
              {specs.length ? specs.map(([key, value]) => (
                <div className="kv-row" key={key}>
                  <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                  <dd>{String(value)}</dd>
                </div>
              )) : <p className="muted">No specs have been confirmed yet.</p>}
            </dl>
          </section>
        </section>

        <section id="manage" className="detail-section">
          <div className="section-heading">
            <div className="eyebrow">Admin</div>
            <h2 className="section-title">Manage this watch</h2>
            <p className="muted section-lede">Nickname, personal link, alerts, and market scope — kept here so research stays front and center.</p>
          </div>
          <div className="manage-grid">
            <section className="panel identity-panel">
              <div>
                <div className="eyebrow">Research alias</div>
                <p className="muted">A required nickname keeps your dashboard readable and is included in relevant market and community searches.</p>
              </div>
              <NicknameEditor id={watch.id} nickname={watch.nickname} />
            </section>
            <section className="panel identity-panel">
              <div>
                <div className="eyebrow">Tracked watch link</div>
                <p className="muted">Keep a direct link to the specific watch you are following. It is stored for your reference only and is not used by market research.</p>
              </div>
              <TrackedWatchUrlEditor id={watch.id} nickname={watch.nickname} trackedWatchUrl={watch.tracked_watch_url} />
            </section>
            <section className="panel">
              <div className="panel-row">
                <div>
                  <div className="eyebrow">Email price alerts</div>
                  <p className="muted">Thresholds apply to asking-price estimates only. Emails are sent after a scheduled run when a price newly crosses a threshold.</p>
                </div>
                <AlertEditor id={watch.id} alert={alert} deliveryEnabled={emailAlertsEnabled()} />
              </div>
            </section>
            <section className="panel">
              <div className="eyebrow">Tracked market scope</div>
              <div className="scope-summary">
                <span className="chip">{watch.scope.condition.replace("_", " ")}</span>
                <span className="chip">papers {watch.scope.papers.replace("_", " ")}</span>
                <span className="chip">box {watch.scope.box.replace("_", " ")}</span>
                <span className="chip">{watch.scope.warranty.replaceAll("_", " ")}</span>
                {watch.scope.yearMin && <span className="chip">from {watch.scope.yearMin}</span>}
                {watch.scope.yearMax && <span className="chip">to {watch.scope.yearMax}</span>}
              </div>
              <ScopeEditor id={watch.id} scope={watch.scope} phase1bEnabled={phase1bEnabled} />
              {market.scopeChanges.length > 0 && (
                <details className="provenance">
                  <summary>Scope-change annotations ({market.scopeChanges.length})</summary>
                  <ul>{market.scopeChanges.map((change) => <li key={change.id}>{change.changed_at.toLocaleDateString()} — the next scan reclassifies listings; earlier snapshots retain their prior scope.</li>)}</ul>
                </details>
              )}
              {watch.notes && <p className="muted">{watch.notes}</p>}
            </section>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
