import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSession } from "@/lib/auth";
import { revokeMcpClient } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clientIdSchema = z.string().min(3).max(200);

export async function DELETE(_request: Request, context: { params: Promise<{ clientId: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { clientId } = await context.params;
  const parsed = clientIdSchema.safeParse(clientId);
  if (!parsed.success) return NextResponse.json({ error: "Unknown connector." }, { status: 404 });
  const revoked = await revokeMcpClient(parsed.data);
  if (!revoked) return NextResponse.json({ error: "Unknown connector." }, { status: 404 });
  return NextResponse.json({ revoked: true });
}
