import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <main className="shell"><header className="topbar"><Link className="brand" href="/">Crown <span>Tracker</span></Link><nav className="nav"><Link className="button secondary" href="/watches/archived">Archived</Link><Link className="button secondary" href="/watches/new">Add watch</Link><form action="/api/auth/logout" method="post"><button className="secondary" type="submit">Sign out</button></form></nav></header>{children}</main>;
}
