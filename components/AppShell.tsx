import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">Crown <span>Tracker</span></Link>
        <nav className="nav" aria-label="Primary">
          <Link className="nav-link" href="/coverage">Coverage</Link>
          <Link className="nav-link" href="/connectors">Connectors</Link>
          <Link className="nav-link" href="/watches/archived">Archived</Link>
          <Link className="button" href="/watches/new">Add watch</Link>
          <form action="/api/auth/logout" method="post">
            <button className="nav-link nav-link-button" type="submit">Sign out</button>
          </form>
        </nav>
      </header>
      {children}
    </main>
  );
}
