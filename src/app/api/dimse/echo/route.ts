import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { runEcho } from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dimse/echo — direct C-ECHO verification, spoken by this process
 * (no gateway needed). Body: { serverId } or { host, port, aeTitle }.
 * Updates the server's lastStatus/lastTestAt when a serverId is given.
 */
export async function POST(req: NextRequest) {
  const denied = await requireSession(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let peer: { aeTitle: string; host: string; port: number } | null = null;
  const serverId = String(body.serverId ?? "");
  if (serverId) {
    const server = await db.pacsServer.findUnique({ where: { id: serverId } });
    if (!server) return NextResponse.json({ error: "PACS server not found." }, { status: 404 });
    peer = { aeTitle: server.aeTitle, host: server.host, port: server.port };
  } else {
    const host = String(body.host ?? "").trim();
    const aeTitle = String(body.aeTitle ?? "").trim().toUpperCase();
    const port = Number(body.port);
    if (!host || !aeTitle || !Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json(
        { error: "host, aeTitle and a valid port (1-65535) are required." },
        { status: 400 }
      );
    }
    peer = { aeTitle, host, port };
  }

  const r = await runEcho(peer);
  if (serverId) {
    await db.pacsServer
      .update({
        where: { id: serverId },
        data: {
          lastStatus: r.ok ? "ok" : "fail",
          lastTestAt: new Date(),
        },
      })
      .catch(() => {});
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
