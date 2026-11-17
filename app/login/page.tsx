import { redirect } from "next/navigation";
import { hasSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await hasSession()) redirect("/");
  const { error } = await searchParams;
  const errorMessage = error === "locked"
    ? "Too many failed attempts. Try again in about 15 minutes."
    : error
      ? "That password didn’t match."
      : null;
  return <main className="login"><section className="panel"><div className="eyebrow">Private collection</div><h1>Welcome back.</h1><p className="muted">Enter the password configured for your Crown Tracker.</p>{errorMessage && <p className="error">{errorMessage}</p>}<form action="/api/auth/login" method="post" className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoFocus required /><button type="submit">Enter dashboard</button></form></section></main>;
}
