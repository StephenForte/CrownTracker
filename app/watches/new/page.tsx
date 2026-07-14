import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { NewWatchForm } from "@/components/NewWatchForm";
import { isPhase1bEnabled } from "@/lib/phase1b";

export const dynamic = "force-dynamic";

export default async function NewWatchPage() {
  if (!(await hasSession())) redirect("/login");
  return <AppShell><main className="form-page"><div className="eyebrow">New tracked watch</div><h1>Add a reference with its market definition.</h1><p className="muted">Save the identity and scope, then use Refresh now to begin a grounded market scan.</p><NewWatchForm phase1bEnabled={isPhase1bEnabled()} /></main></AppShell>;
}
