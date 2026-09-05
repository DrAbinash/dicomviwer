import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findStudiesRemote, OrthancError, type RemoteStudy } from "@/lib/server/orthanc";
import { requireSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dicom/find — C-FIND study query on a user-added remote PACS,
 * performed by the gateway (Orthanc SCU). Results are normalised to the same
 * shape the viewer's PACS dialog already renders.
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

  const serverId = String(body.serverId ?? "");
  const server = serverId
    ? await db.pacsServer.findUnique({ where: { id: serverId } })
    : null;
  if (!server) {
    return NextResponse.json(
      { error: "Select a PACS server (or configure one in Settings)." },
      { status: 404 }
    );
  }

  const str = (k: string) => {
    const v = body[k];
    return typeof v === "string" ? v.trim() : "";
  };

  try {
    const studies: RemoteStudy[] = await findStudiesRemote(server.aeTitle, {
      patientName: str("patientName") || undefined,
      patientId: str("patientId") || undefined,
      dateFrom: str("dateFrom") || undefined,
      dateTo: str("dateTo") || undefined,
      modality: str("modality") || undefined,
      accession: str("accession") || undefined,
      limit: 60,
    });
    return NextResponse.json({ studies, server: { name: server.name, aeTitle: server.aeTitle } });
  } catch (e) {
    const msg = e instanceof OrthancError || e instanceof Error ? e.message : "C-FIND failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
