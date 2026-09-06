import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/server/auth";
import { startSendJob } from "@/lib/server/dimse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dimse/send — direct C-STORE push of a held study/series to a
 * configured DICOM node. Source resolution: the viewer's local inbox first,
 * then the Orthanc gateway cache. Runs as a job; poll /api/dimse/jobs/[id].
 *
 * Body: { serverId, studyUid, seriesUid? }
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
  const studyUid = String(body.studyUid ?? "").trim();
  const seriesUid = typeof body.seriesUid === "string" && body.seriesUid ? body.seriesUid : null;

  if (!studyUid || !/^[0-9.]+$/.test(studyUid)) {
    return NextResponse.json({ error: "A valid Study Instance UID is required." }, { status: 400 });
  }
  const server = await db.pacsServer.findUnique({ where: { id: serverId } });
  if (!server) {
    return NextResponse.json({ error: "Destination not found." }, { status: 404 });
  }

  try {
    const jobId = await startSendJob({
      peer: { aeTitle: server.aeTitle, host: server.host, port: server.port },
      studyUid,
      seriesUid,
    });
    return NextResponse.json({ jobId, destination: { name: server.name, aeTitle: server.aeTitle } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed to start";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
