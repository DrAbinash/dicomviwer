import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startRetrieve, OrthancError, type RetrieveMethod } from "@/lib/server/orthanc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/dicom/retrieve — start pulling a study from a remote PACS into
 * the gateway (Orthanc). Runs as an Orthanc job; poll /api/dicom/jobs/[id].
 *
 * method:
 *  - "cget"  (default) — gateway issues C-GET; the remote PACS must support
 *    C-GET SCP, but it needs no knowledge of this viewer.
 *  - "cmove" — gateway issues C-MOVE to the gateway AE Title; the remote
 *    PACS must have this viewer's AE Title + IP + port registered.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const serverId = String(body.serverId ?? "");
  const studyUid = String(body.studyUid ?? "").trim();
  const method: RetrieveMethod = body.method === "cmove" ? "cmove" : "cget";

  if (!studyUid || !/^[0-9.]+$/.test(studyUid)) {
    return NextResponse.json({ error: "A valid Study Instance UID is required." }, { status: 400 });
  }

  const server = await db.pacsServer.findUnique({ where: { id: serverId } });
  if (!server) {
    return NextResponse.json({ error: "PACS server not found." }, { status: 404 });
  }

  try {
    const jobId = await startRetrieve(server.aeTitle, studyUid, method);
    return NextResponse.json({ jobId, method });
  } catch (e) {
    const msg = e instanceof OrthancError || e instanceof Error ? e.message : "Retrieve failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
