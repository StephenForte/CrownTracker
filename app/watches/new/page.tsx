import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { NewWatchForm } from "@/components/NewWatchForm";

export const dynamic = "force-dynamic";

export default async function NewWatchPage() {
  if (!(await hasSession())) redirect("/login");
  return <AppShell><main className="form-page"><div className="eyebrow">New tracked watch</div><h1>Add a reference with its market definition.</h1><p className="muted">The market pipeline is not active yet; this creates the durable identity and scope it will use.</p><NewWatchForm /></main></AppShell>;
}
