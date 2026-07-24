import { NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { listMcpConnectorClients, revokeAllMcpClients } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const clients = await listMcpConnectorClients();
  return NextResponse.json({
    clients: clients.map((client) => ({
      clientId: client.clientId,
      clientName: client.clientName,
      redirectOrigin: client.redirectOrigin,
      createdAt: client.createdAt.toISOString(),
      lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
      status: client.status,
      activeTokenCount: client.activeTokenCount,
    })),
  });
}

export async function DELETE() {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const revoked = await revokeAllMcpClients();
  return NextResponse.json({ revoked });
}
