import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { runFind, type FindFilters } from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dimse/query — direct C-FIND (study level) against a configured
 * PACS, spoken by this process without any gateway. Body:
 * { serverId, patientName?, patientId?, dateFrom?, dateTo?, modality?, accession? }
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

  const server = await db.pacsServer.findUnique({ where: { id: String(body.serverId ?? "") } });
  if (!server) {
    return NextResponse.json({ error: "Select a PACS server (or add one in Settings)." }, { status: 404 });
  }

  const str = (k: string) => {
    const v = body[k];
    return typeof v === "string" ? v.trim() : "";
  };
  const filters: FindFilters = {
    patientName: str("patientName") || undefined,
    patientId: str("patientId") || undefined,
    dateFrom: str("dateFrom") || undefined,
    dateTo: str("dateTo") || undefined,
    modality: str("modality") || undefined,
    accession: str("accession") || undefined,
  };

  try {
    const studies = await runFind(
      { aeTitle: server.aeTitle, host: server.host, port: server.port },
      filters
    );
    return NextResponse.json({
      studies: studies.filter((s) => s.studyUid),
      server: { name: server.name, aeTitle: server.aeTitle },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "C-FIND failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
